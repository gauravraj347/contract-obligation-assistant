import * as documentsModel from '../models/document.model.js';
import * as itemsModel from '../models/extractedItem.model.js';
import * as runs from '../models/extractionRun.model.js';
import * as sectionsModel from '../models/section.model.js';
import * as versions from '../models/contractVersion.model.js';
import { buildExtractionPrompt, EXTRACTION_JSON_SCHEMA, PROMPT_VERSION, SYSTEM_INSTRUCTION } from '../prompts/extraction.prompt.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { buildItemsFromModelOutput, keySections } from './extractionItemBuilder.js';

/**
 * AI extraction workflow for one contract version:
 *   queued -> running -> (LLM call) -> validate + verify citations -> items persisted as "pending" -> succeeded
 *                                   \-> failed (error code + message stored, retry allowed)
 * Nothing the AI produces is trusted: every item starts "pending" until a human reviews it.
 */
export function createExtractionService({ db, logger, llm, jobRunner }) {
  const log = logger.child({ component: 'extractionService' });

  async function loadDocuments(contractVersionId) {
    const docs = await documentsModel.listDocumentsByVersionIds(db, [contractVersionId]);
    const sections = await sectionsModel.listSectionsByDocumentIds(
      db,
      docs.map((d) => d.id),
    );
    // Contract first so section keys are stable (C1..Cn, then P1..Pn).
    return docs
      .map((doc) => ({ ...doc, sections: sections.filter((s) => s.documentId === doc.id) }))
      .sort((a, b) => (a.role === 'contract' ? -1 : b.role === 'contract' ? 1 : 0));
  }

  async function processRun(runId) {
    const run = await runs.markRunning(db, runId);
    if (!run) return; // already claimed or no longer queued
    const context = { runId, contractVersionId: run.contractVersionId, promptVersion: PROMPT_VERSION };
    const startedAt = Date.now();
    log.info({ event: 'ai.extraction.started', ...context, model: llm.model }, 'extraction started');

    let llmResult = null;
    try {
      const documents = await loadDocuments(run.contractVersionId);
      const { keyed, sectionsByKey } = keySections(documents);
      llmResult = await llm.generateJson({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: buildExtractionPrompt(keyed),
        jsonSchema: EXTRACTION_JSON_SCHEMA,
        context,
      });

      const built = buildItemsFromModelOutput(llmResult.data, sectionsByKey);
      if (!built.outputShapeValid) {
        throw new AppError('AI output did not match the expected structure', { code: 'AI_INVALID_OUTPUT' });
      }

      await db.transaction(async (trx) => {
        await itemsModel.insertItemsWithCitations(trx, {
          contractVersionId: run.contractVersionId,
          extractionRunId: run.id,
          items: built.items,
        });
        await runs.markSucceeded(trx, run.id, {
          model: llmResult.model,
          inputTokens: llmResult.usage.inputTokens,
          outputTokens: llmResult.usage.outputTokens,
          latencyMs: llmResult.latencyMs,
          itemCount: built.items.length,
          invalidItemCount: built.invalidCount,
          unverifiedCitationCount: built.unverifiedCitationCount,
          warnings: built.warnings,
          rawResponse: llmResult.data,
        });
      });

      log.info(
        {
          event: 'ai.extraction.succeeded',
          ...context,
          model: llmResult.model,
          itemCount: built.items.length,
          invalidItemCount: built.invalidCount,
          unverifiedCitationCount: built.unverifiedCitationCount,
          remappedCitationCount: built.remappedCitationCount,
          inputTokens: llmResult.usage.inputTokens,
          outputTokens: llmResult.usage.outputTokens,
          llmLatencyMs: llmResult.latencyMs,
          durationMs: Date.now() - startedAt,
        },
        'extraction succeeded',
      );
    } catch (err) {
      const errorCode = err instanceof AppError ? err.code : 'EXTRACTION_FAILED';
      const errorMessage = err instanceof AppError ? err.message : 'Unexpected error while processing the extraction';
      await runs.markFailed(db, run.id, {
        errorCode,
        errorMessage,
        ...(llmResult ? { rawResponse: llmResult.data, latencyMs: llmResult.latencyMs } : {}),
      });
      const level = err instanceof AppError ? 'warn' : 'error';
      log[level](
        { event: 'ai.extraction.failed', ...context, errorCode, durationMs: Date.now() - startedAt, ...(level === 'error' ? { err } : {}) },
        'extraction failed',
      );
    }
  }

  /**
   * Queues an extraction for a version. Allowed when the version has no run yet or the latest
   * run failed (retry). A succeeded run is never silently replaced, because its items may already
   * carry human review decisions.
   */
  async function startExtraction(contractVersionId) {
    const run = await db.transaction(async (trx) => {
      const version = await versions.findVersionById(trx, contractVersionId);
      if (!version) throw new NotFoundError('Contract version not found');
      // Serialise concurrent start requests for the same version.
      await trx('contractVersions').where({ id: contractVersionId }).forUpdate().first();

      const latest = await runs.findLatestRunForVersion(trx, contractVersionId);
      if (latest && runs.ACTIVE_STATUSES.includes(latest.status)) {
        throw new AppError('An extraction is already in progress for this version', {
          status: 409,
          code: 'EXTRACTION_IN_PROGRESS',
          details: { runId: latest.id },
        });
      }
      if (latest?.status === 'succeeded') {
        throw new AppError('This version has already been extracted', {
          status: 409,
          code: 'ALREADY_EXTRACTED',
          details: { runId: latest.id },
        });
      }
      return runs.insertRun(trx, { contractVersionId, model: llm.model, promptVersion: PROMPT_VERSION });
    });

    log.info({ event: 'ai.extraction.queued', runId: run.id, contractVersionId }, 'extraction queued');
    jobRunner.enqueue(`extraction:${run.id}`, () => processRun(run.id));
    return run;
  }

  async function getRun(runId) {
    const run = await runs.findRunById(db, runId);
    if (!run) throw new NotFoundError('Extraction run not found');
    return run;
  }

  async function listRuns(contractVersionId) {
    const version = await versions.findVersionById(db, contractVersionId);
    if (!version) throw new NotFoundError('Contract version not found');
    return runs.listRunsForVersion(db, contractVersionId);
  }

  async function listItems(contractVersionId) {
    const version = await versions.findVersionById(db, contractVersionId);
    if (!version) throw new NotFoundError('Contract version not found');
    return itemsModel.listItemsForVersion(db, contractVersionId);
  }

  async function recoverInterruptedRuns() {
    const failed = await runs.failInterruptedRuns(db);
    if (failed.length) {
      log.warn({ event: 'ai.extraction.recovered', runIds: failed.map((r) => r.id) }, 'marked interrupted runs as failed');
    }
    return failed.length;
  }

  return { startExtraction, processRun, getRun, listRuns, listItems, recoverInterruptedRuns };
}
