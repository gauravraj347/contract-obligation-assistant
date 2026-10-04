const ITEMS = 'extractedItems';
const CITATIONS = 'itemCitations';

/** Inserts items and their citations. ai_value and current_value start identical. */
export async function insertItemsWithCitations(db, { contractVersionId, extractionRunId, items }) {
  if (items.length === 0) return [];
  const rows = await db(ITEMS)
    .insert(
      items.map((item) => ({
        contractVersionId,
        extractionRunId,
        itemType: item.itemType,
        label: item.label,
        aiValue: JSON.stringify(item.aiValue),
        currentValue: JSON.stringify(item.aiValue),
        certainty: item.certainty,
        certaintyReason: item.certaintyReason,
        responsibleParty: item.responsibleParty,
        clarificationQuestion: item.clarificationQuestion,
      })),
    )
    .returning(['id']);

  // PostgreSQL returns rows from a multi-row INSERT ... RETURNING in insertion order.
  const citationRows = rows.flatMap((row, index) =>
    items[index].citations.map((citation) => ({ itemId: row.id, ...citation })),
  );
  if (citationRows.length) await db(CITATIONS).insert(citationRows);
  return rows;
}

function attachCitations(items, citations) {
  const byItem = new Map();
  for (const citation of citations) {
    if (!byItem.has(citation.itemId)) byItem.set(citation.itemId, []);
    byItem.get(citation.itemId).push(citation);
  }
  return items.map((item) => ({ ...item, citations: byItem.get(item.id) ?? [] }));
}

/** Citations with the cited section's heading and text hash (used for staleness comparison). */
export async function listCitationsForItems(db, itemIds) {
  if (itemIds.length === 0) return [];
  return db(`${CITATIONS} as ic`)
    .select('ic.*', 's.heading as sectionHeading', 's.textHash as sectionHash')
    .leftJoin('sections as s', 's.id', 'ic.sectionId')
    .whereIn('ic.itemId', itemIds);
}

async function withCitations(db, items) {
  if (items.length === 0) return [];
  const citations = await listCitationsForItems(
    db,
    items.map((item) => item.id),
  );
  return attachCitations(items, citations);
}

export async function listItemsForVersion(db, contractVersionId) {
  const items = await db(ITEMS).where({ contractVersionId }).orderBy([{ column: 'itemType' }, { column: 'createdAt' }]);
  return withCitations(db, items);
}

export async function findItemById(db, id, { forUpdate = false } = {}) {
  const query = db(ITEMS).where({ id }).first();
  return forUpdate ? query.forUpdate() : query;
}

export async function findItemWithCitations(db, id) {
  const item = await findItemById(db, id);
  if (!item) return null;
  const [withCites] = await withCitations(db, [item]);
  return withCites;
}

export async function updateItem(db, id, changes) {
  const update = { ...changes, updatedAt: db.fn.now() };
  if ('currentValue' in update) update.currentValue = JSON.stringify(update.currentValue);
  const [row] = await db(ITEMS).where({ id }).update(update).returning('*');
  return row;
}

/** Approved items belonging to the contract's earlier versions (candidates for the stale flag). */
export async function listApprovedItemsOfOtherVersions(db, { contractId, excludeVersionId }) {
  const items = await db(`${ITEMS} as i`)
    .select('i.*')
    .join('contractVersions as v', 'v.id', 'i.contractVersionId')
    .where('v.contractId', contractId)
    .whereNot('i.contractVersionId', excludeVersionId)
    .where('i.status', 'approved');
  return withCitations(db, items);
}

/** Approved items with contract/version info, for one contract or all contracts (dashboard). */
export async function listApprovedItems(db, { contractId } = {}) {
  const query = db(`${ITEMS} as i`)
    .select('i.*', 'v.contractId', 'v.versionNumber')
    .join('contractVersions as v', 'v.id', 'i.contractVersionId')
    .where('i.status', 'approved');
  if (contractId) query.where('v.contractId', contractId);
  return withCitations(db, await query);
}

/** Pending items in each contract's latest version, and potentially stale approved items. */
export async function countReviewQueue(db) {
  const latestVersions = db('contractVersions as lv')
    .select('lv.id')
    .whereRaw('lv.version_number = (select max(version_number) from contract_versions where contract_id = lv.contract_id)');
  const [pending] = await db(ITEMS).where({ status: 'pending' }).whereIn('contractVersionId', latestVersions).count({ count: '*' });
  const [stale] = await db(ITEMS).where({ status: 'approved', potentiallyStale: true }).count({ count: '*' });
  return { pendingItems: Number(pending.count), potentiallyStaleItems: Number(stale.count) };
}

/**
 * Items reviewers work with for a contract: every item of the latest version, plus approved
 * items carried from earlier versions (stale until reconfirmed or rejected).
 */
export async function listItemsForContractReview(db, { contractId, latestVersionId }) {
  const items = await db(`${ITEMS} as i`)
    .select('i.*', 'v.versionNumber')
    .join('contractVersions as v', 'v.id', 'i.contractVersionId')
    .where('v.contractId', contractId)
    .andWhere((query) => query.where('i.contractVersionId', latestVersionId).orWhere('i.status', 'approved'))
    .orderBy([{ column: 'v.versionNumber', order: 'desc' }, { column: 'i.itemType' }, { column: 'i.createdAt' }]);
  return withCitations(db, items);
}
