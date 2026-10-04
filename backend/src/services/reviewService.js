import * as contracts from '../models/contract.model.js';
import * as items from '../models/extractedItem.model.js';
import * as reviews from '../models/itemReview.model.js';
import * as versions from '../models/contractVersion.model.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { planDecision, planEdit, snapshot } from './reviewRules.js';
import { describeStaleness } from './staleness.js';

/**
 * Flags every approved item from the contract's earlier versions as potentially stale.
 * Runs inside the transaction that creates the new version, so the flag can never be missed.
 *
 * @param {import('knex').Knex.Transaction} trx
 * @param {{ contractId, newVersion: { id, versionNumber }, newSections: { contract: Array, policy: Array } }} args
 * @returns {Promise<number>} number of items flagged
 */
export async function flagApprovedItemsAsStale(trx, { contractId, newVersion, newSections }) {
  const approved = await items.listApprovedItemsOfOtherVersions(trx, { contractId, excludeVersionId: newVersion.id });
  const auditRows = [];

  for (const item of approved) {
    const { reason, citationChanges } = describeStaleness(item.citations, newSections, newVersion.versionNumber);
    const changes = { potentiallyStale: true, staleReason: reason, staleSinceVersionId: newVersion.id };
    await items.updateItem(trx, item.id, changes);
    auditRows.push({
      itemId: item.id,
      action: 'mark_stale',
      actor: 'system',
      before: { potentiallyStale: item.potentiallyStale, staleReason: item.staleReason },
      after: { ...changes, citationChanges },
    });
  }
  await reviews.insertReviews(trx, auditRows);
  return approved.length;
}

function countByStatus(list) {
  const counts = { pending: 0, approved: 0, rejected: 0, potentiallyStale: 0, total: list.length };
  for (const item of list) {
    counts[item.status] += 1;
    if (item.potentiallyStale) counts.potentiallyStale += 1;
  }
  return counts;
}

export function createReviewService({ db, logger }) {
  const log = logger.child({ component: 'reviewService' });

  async function getItem(itemId) {
    const item = await items.findItemWithCitations(db, itemId);
    if (!item) throw new NotFoundError('Item not found');
    return { ...item, reviews: await reviews.listReviewsForItem(db, itemId) };
  }

  /** Locks the item row, applies a planned change, and writes the audit row in one transaction. */
  async function mutate(itemId, plan) {
    const result = await db.transaction(async (trx) => {
      const item = await items.findItemById(trx, itemId, { forUpdate: true });
      if (!item) throw new NotFoundError('Item not found');
      const planned = await plan(trx, item);
      const updated = await items.updateItem(trx, itemId, planned.changes);
      await reviews.insertReview(trx, {
        itemId,
        action: planned.action,
        before: snapshot(item),
        after: snapshot(updated),
        note: planned.note,
      });
      return { item: updated, action: planned.action, previousStatus: item.status };
    });

    log.info(
      {
        event: `review.${result.action}`,
        itemId,
        itemType: result.item.itemType,
        fromStatus: result.previousStatus,
        toStatus: result.item.status,
      },
      'item reviewed',
    );
    return getItem(itemId);
  }

  function editItem(itemId, patch) {
    return mutate(itemId, async (_trx, item) => {
      const planned = planEdit(item, patch);
      if (!planned) {
        throw new ValidationError('The edit does not change anything', [{ path: '', message: 'No changes' }]);
      }
      return { action: 'edit', changes: planned.changes, note: patch.note };
    });
  }

  function decide(itemId, decision, { note } = {}) {
    return mutate(itemId, async (trx, item) => {
      const citations = await items.listCitationsForItems(trx, [item.id]);
      const hasUnverifiedCitation = citations.some((citation) => !citation.verified);
      const planned = planDecision(item, decision, { note, hasUnverifiedCitation });
      return { ...planned, note };
    });
  }

  /** Review workspace for a contract: latest version items plus approved items carried from older versions. */
  async function getContractReview(contractId) {
    const contract = await contracts.findContractById(db, contractId);
    if (!contract) throw new NotFoundError('Contract not found');
    const latest = await versions.findLatestVersion(db, contractId);
    const list = await items.listItemsForContractReview(db, { contractId, latestVersionId: latest.id });

    const current = list.filter((item) => item.contractVersionId === latest.id);
    const carriedOver = list.filter((item) => item.contractVersionId !== latest.id);
    return {
      contractId,
      latestVersion: { id: latest.id, versionNumber: latest.versionNumber },
      items: current,
      carriedOverItems: carriedOver,
      counts: { current: countByStatus(current), carriedOver: countByStatus(carriedOver) },
    };
  }

  return {
    getItem,
    editItem,
    approveItem: (itemId, body) => decide(itemId, 'approve', body),
    rejectItem: (itemId, body) => decide(itemId, 'reject', body),
    reopenItem: (itemId, body) => decide(itemId, 'reopen', body),
    getContractReview,
  };
}
