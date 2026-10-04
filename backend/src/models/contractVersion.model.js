const TABLE = 'contractVersions';

export async function insertVersion(db, { contractId, versionNumber, note }) {
  const [row] = await db(TABLE).insert({ contractId, versionNumber, note: note ?? null }).returning('*');
  return row;
}

export async function findLatestVersion(db, contractId) {
  return db(TABLE).where({ contractId }).orderBy('versionNumber', 'desc').first();
}

export async function findVersionById(db, id) {
  return db(TABLE).where({ id }).first();
}

export async function listVersionsByContract(db, contractId) {
  return db(TABLE).where({ contractId }).orderBy('versionNumber', 'desc');
}
