const TABLE = 'documents';

const METADATA_COLUMNS = [
  'id',
  'contractVersionId',
  'role',
  'sourceType',
  'originalFilename',
  'mimeType',
  'textHash',
  'charCount',
  'createdAt',
];

export async function insertDocument(db, document) {
  const [row] = await db(TABLE).insert(document).returning(METADATA_COLUMNS);
  return row;
}

/** Full document including raw text (used when re-processing or carrying a policy forward). */
export async function findDocumentByVersionAndRole(db, contractVersionId, role) {
  return db(TABLE).where({ contractVersionId, role }).first();
}

/** Metadata only; raw text is served through sections. */
export async function listDocumentsByVersionIds(db, versionIds) {
  if (versionIds.length === 0) return [];
  return db(TABLE).select(METADATA_COLUMNS).whereIn('contractVersionId', versionIds).orderBy('role');
}
