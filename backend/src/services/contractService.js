import * as contracts from '../models/contract.model.js';
import * as documents from '../models/document.model.js';
import * as sectionsModel from '../models/section.model.js';
import * as versions from '../models/contractVersion.model.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { sha256 } from '../utils/hash.js';
import { parseDocument } from './documentParser.js';
import { flagApprovedItemsAsStale } from './reviewService.js';
import { sectionize } from './sectionizer.js';

/**
 * Parses and sectionises a document in memory. Runs before any DB transaction
 * so slow PDF parsing never holds a connection or lock.
 */
export async function prepareDocument(input, role) {
  const parsed = await parseDocument(input, role);
  return { ...parsed, textHash: sha256(parsed.text), sections: sectionize(parsed.text) };
}

function defaultTitle(contractInput) {
  if (contractInput.kind === 'file') {
    return contractInput.originalName.replace(/\.[^.]+$/, '').trim() || 'Untitled contract';
  }
  return 'Untitled contract';
}

async function persistDocument(trx, contractVersionId, prepared) {
  const document = await documents.insertDocument(trx, {
    contractVersionId,
    role: prepared.role,
    sourceType: prepared.sourceType,
    originalFilename: prepared.originalFilename,
    mimeType: prepared.mimeType,
    rawText: prepared.text,
    textHash: prepared.textHash,
    charCount: prepared.text.length,
  });
  await sectionsModel.insertSections(trx, document.id, prepared.sections);
  return { ...document, sectionCount: prepared.sections.length };
}

/** Rebuilds a stored policy for a new version (sectionising is deterministic, so the result is identical). */
function preparedFromStored(stored) {
  return {
    role: stored.role,
    sourceType: stored.sourceType,
    originalFilename: stored.originalFilename,
    mimeType: stored.mimeType,
    text: stored.rawText,
    textHash: stored.textHash,
    sections: sectionize(stored.rawText),
  };
}

export function createContractService({ db, logger }) {
  const log = logger.child({ component: 'contractService' });

  async function createContract({ title, contractInput, policyInput }) {
    const startedAt = Date.now();
    const contractDoc = await prepareDocument(contractInput, 'contract');
    const policyDoc = policyInput ? await prepareDocument(policyInput, 'policy') : null;

    const result = await db.transaction(async (trx) => {
      const contract = await contracts.insertContract(trx, { title: title || defaultTitle(contractInput) });
      const version = await versions.insertVersion(trx, { contractId: contract.id, versionNumber: 1 });
      const docs = [await persistDocument(trx, version.id, contractDoc)];
      if (policyDoc) docs.push(await persistDocument(trx, version.id, policyDoc));
      return { contract, version: { ...version, documents: docs } };
    });

    log.info(
      {
        event: 'contract.created',
        contractId: result.contract.id,
        versionId: result.version.id,
        documents: result.version.documents.map((d) => ({
          role: d.role,
          sourceType: d.sourceType,
          charCount: d.charCount,
          sectionCount: d.sectionCount,
        })),
        durationMs: Date.now() - startedAt,
      },
      'contract created',
    );
    return result;
  }

  async function addVersion(contractId, { note, contractInput, policyInput }) {
    const startedAt = Date.now();
    const existing = await contracts.findContractById(db, contractId);
    if (!existing) throw new NotFoundError('Contract not found');

    const contractDoc = await prepareDocument(contractInput, 'contract');
    const newPolicyDoc = policyInput ? await prepareDocument(policyInput, 'policy') : null;

    const result = await db.transaction(async (trx) => {
      // Row lock serialises concurrent uploads so version numbers stay sequential.
      await contracts.findContractById(trx, contractId, { forUpdate: true });
      const previous = await versions.findLatestVersion(trx, contractId);
      const previousContractDoc = await documents.findDocumentByVersionAndRole(trx, previous.id, 'contract');
      const previousPolicyDoc = await documents.findDocumentByVersionAndRole(trx, previous.id, 'policy');

      const contractUnchanged = previousContractDoc.textHash === contractDoc.textHash;
      const policyUnchanged = !newPolicyDoc || newPolicyDoc.textHash === previousPolicyDoc?.textHash;
      if (contractUnchanged && policyUnchanged) {
        throw new AppError('This contract text is identical to the current version', {
          status: 409,
          code: 'DUPLICATE_VERSION',
          details: { currentVersionNumber: previous.versionNumber },
        });
      }

      // Without a new policy upload, the existing policy stays in force for the new version.
      const policyDoc = newPolicyDoc ?? (previousPolicyDoc ? preparedFromStored(previousPolicyDoc) : null);

      const version = await versions.insertVersion(trx, {
        contractId,
        versionNumber: previous.versionNumber + 1,
        note,
      });
      const docs = [await persistDocument(trx, version.id, contractDoc)];
      if (policyDoc) docs.push(await persistDocument(trx, version.id, policyDoc));
      await contracts.touchContract(trx, contractId);

      const staleItemCount = await flagApprovedItemsAsStale(trx, {
        contractId,
        newVersion: version,
        newSections: { contract: contractDoc.sections, policy: policyDoc?.sections ?? [] },
      });

      return {
        version: { ...version, documents: docs },
        previousVersionId: previous.id,
        policyCarriedOver: !newPolicyDoc && Boolean(previousPolicyDoc),
        contractTextChanged: !contractUnchanged,
        staleItemCount,
      };
    });

    log.info(
      {
        event: 'contract.version_added',
        contractId,
        versionId: result.version.id,
        versionNumber: result.version.versionNumber,
        previousVersionId: result.previousVersionId,
        policyCarriedOver: result.policyCarriedOver,
        contractTextChanged: result.contractTextChanged,
        staleItemCount: result.staleItemCount,
        durationMs: Date.now() - startedAt,
      },
      'contract version added',
    );
    return result;
  }

  async function listContracts() {
    const rows = await contracts.listContracts(db);
    return rows.map((row) => ({ ...row, versionCount: Number(row.versionCount) }));
  }

  async function getContract(contractId) {
    const contract = await contracts.findContractById(db, contractId);
    if (!contract) throw new NotFoundError('Contract not found');
    const versionRows = await versions.listVersionsByContract(db, contractId);
    const docs = await documents.listDocumentsByVersionIds(
      db,
      versionRows.map((v) => v.id),
    );
    return {
      ...contract,
      versions: versionRows.map((v) => ({ ...v, documents: docs.filter((d) => d.contractVersionId === v.id) })),
    };
  }

  /** A single version with its documents and their sections (the citable source text). */
  async function getVersion(versionId) {
    const version = await versions.findVersionById(db, versionId);
    if (!version) throw new NotFoundError('Contract version not found');
    const docs = await documents.listDocumentsByVersionIds(db, [version.id]);
    const sectionRows = await sectionsModel.listSectionsByDocumentIds(
      db,
      docs.map((d) => d.id),
    );
    return {
      ...version,
      documents: docs.map((d) => ({ ...d, sections: sectionRows.filter((s) => s.documentId === d.id) })),
    };
  }

  return { createContract, addVersion, listContracts, getContract, getVersion };
}
