const TABLE = 'contracts';

export async function insertContract(db, { title }) {
  const [row] = await db(TABLE).insert({ title }).returning('*');
  return row;
}

export async function findContractById(db, id, { forUpdate = false } = {}) {
  const query = db(TABLE).where({ id }).first();
  return forUpdate ? query.forUpdate() : query;
}

export async function touchContract(db, id) {
  await db(TABLE).where({ id }).update({ updatedAt: db.fn.now() });
}

/** Contracts with their latest version number, newest activity first. */
export async function listContracts(db) {
  return db(`${TABLE} as c`)
    .select('c.id', 'c.title', 'c.createdAt', 'c.updatedAt')
    .max({ latestVersionNumber: 'v.versionNumber' })
    .count({ versionCount: 'v.id' })
    .leftJoin('contractVersions as v', 'v.contractId', 'c.id')
    .groupBy('c.id')
    .orderBy('c.updatedAt', 'desc');
}
