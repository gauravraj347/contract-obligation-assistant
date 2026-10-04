import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { createDb } from './knex.js';

const logger = createLogger({ level: config.logLevel });
const command = process.argv[2] ?? 'latest';

async function run() {
  const db = createDb(config.database);
  try {
    if (command === 'latest') {
      const [batch, applied] = await db.migrate.latest();
      logger.info({ batch, applied }, applied.length ? 'migrations applied' : 'database already up to date');
    } else if (command === 'rollback') {
      const [batch, reverted] = await db.migrate.rollback();
      logger.info({ batch, reverted }, 'migrations rolled back');
    } else if (command === 'status') {
      const [completed, pending] = await db.migrate.list();
      logger.info(
        { completed: completed.map((m) => m.name), pending: pending.map((m) => m.file) },
        'migration status',
      );
    } else {
      throw new Error(`Unknown migrate command "${command}". Use latest | rollback | status.`);
    }
  } finally {
    await db.destroy();
  }
}

run().catch((error) => {
  logger.fatal({ err: error }, 'migration command failed');
  process.exitCode = 1;
});
