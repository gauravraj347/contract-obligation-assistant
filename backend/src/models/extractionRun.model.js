const TABLE = 'extractionRuns';

/** raw_response can be large and contains document content; only fetched when explicitly needed. */
const SUMMARY_COLUMNS = [
  'id',
  'contractVersionId',
  'status',
  'model',
  'promptVersion',
  'inputTokens',
  'outputTokens',
  'latencyMs',
  'itemCount',
  'invalidItemCount',
  'unverifiedCitationCount',
  'warnings',
  'errorCode',
  'errorMessage',
  'createdAt',
  'startedAt',
  'finishedAt',
];

export const ACTIVE_STATUSES = Object.freeze(['queued', 'running']);

export async function insertRun(db, { contractVersionId, model, promptVersion }) {
  const [row] = await db(TABLE).insert({ contractVersionId, model, promptVersion }).returning(SUMMARY_COLUMNS);
  return row;
}

export async function findRunById(db, id) {
  return db(TABLE).select(SUMMARY_COLUMNS).where({ id }).first();
}

export async function findLatestRunForVersion(db, contractVersionId) {
  return db(TABLE).select(SUMMARY_COLUMNS).where({ contractVersionId }).orderBy('createdAt', 'desc').first();
}

export async function listRunsForVersion(db, contractVersionId) {
  return db(TABLE).select(SUMMARY_COLUMNS).where({ contractVersionId }).orderBy('createdAt', 'desc');
}

/** Atomically claims a queued run; returns null if another worker already took it. */
export async function markRunning(db, id) {
  const [row] = await db(TABLE)
    .where({ id, status: 'queued' })
    .update({ status: 'running', startedAt: db.fn.now() })
    .returning(SUMMARY_COLUMNS);
  return row ?? null;
}

export async function markSucceeded(db, id, fields) {
  const [row] = await db(TABLE)
    .where({ id })
    .update({
      status: 'succeeded',
      finishedAt: db.fn.now(),
      ...fields,
      warnings: JSON.stringify(fields.warnings ?? []),
      rawResponse: JSON.stringify(fields.rawResponse ?? null),
    })
    .returning(SUMMARY_COLUMNS);
  return row;
}

export async function markFailed(db, id, { errorCode, errorMessage, ...fields }) {
  const update = { status: 'failed', finishedAt: db.fn.now(), errorCode, errorMessage, ...fields };
  if ('warnings' in fields) update.warnings = JSON.stringify(fields.warnings);
  if ('rawResponse' in fields) update.rawResponse = JSON.stringify(fields.rawResponse);
  const [row] = await db(TABLE).where({ id }).update(update).returning(SUMMARY_COLUMNS);
  return row;
}

/** On boot: any run left queued/running by a previous process can never finish. */
export async function failInterruptedRuns(db) {
  return db(TABLE)
    .whereIn('status', ACTIVE_STATUSES)
    .update({
      status: 'failed',
      finishedAt: db.fn.now(),
      errorCode: 'INTERRUPTED',
      errorMessage: 'The server restarted before this extraction finished. Retry the extraction.',
    })
    .returning(['id']);
}
