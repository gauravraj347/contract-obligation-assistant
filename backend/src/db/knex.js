import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';
import { knexCaseMappers } from '../utils/case.js';

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function buildKnexConfig({ url, ssl }) {
  return {
    client: 'pg',
    connection: {
      connectionString: url,
      ssl: ssl ? { rejectUnauthorized: false } : false,
    },
    pool: { min: 0, max: 10 },
    ...knexCaseMappers,
    migrations: {
      directory: migrationsDirectory,
      tableName: 'knex_migrations',
      loadExtensions: ['.js'],
    },
  };
}

export function createDb(databaseConfig) {
  return knex(buildKnexConfig(databaseConfig));
}

/** Lightweight connectivity probe used by the readiness check. */
export async function pingDb(db) {
  await db.raw('select 1');
}
