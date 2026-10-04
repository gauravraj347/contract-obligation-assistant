import config from './config/index.js';
import { createApp } from './app.js';
import { createDb, pingDb } from './db/knex.js';
import { createGeminiClient } from './services/ai/geminiClient.js';
import { createContractService } from './services/contractService.js';
import { createExtractionService } from './services/extractionService.js';
import { createJobRunner } from './services/jobRunner.js';
import { createReportingService } from './services/reportingService.js';
import { createReviewService } from './services/reviewService.js';
import { createLogger } from './utils/logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });
const db = createDb(config.database);

async function start() {
  try {
    await pingDb(db);
    logger.info('database connection established');
  } catch (err) {
    logger.fatal({ err }, 'cannot connect to database; check DATABASE_URL');
    await db.destroy();
    process.exit(1);
  }

  const llm = createGeminiClient({ ...config.ai, logger });
  if (!llm.isConfigured) {
    logger.warn('GEMINI_API_KEY is not set: uploads work, but AI extraction runs will fail with AI_NOT_CONFIGURED');
  }
  const jobRunner = createJobRunner({ logger });
  const contractService = createContractService({ db, logger });
  const extractionService = createExtractionService({ db, logger, llm, jobRunner });
  await extractionService.recoverInterruptedRuns();

  const app = createApp({
    logger,
    checkDatabase: () => pingDb(db),
    services: {
      contractService,
      extractionService,
      reviewService: createReviewService({ db, logger }),
      reportingService: createReportingService({ db, logger }),
    },
    corsOrigins: config.corsOrigins,
    frontendDistDir: config.frontendDistDir,
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, aiModel: llm.model }, 'API server listening');
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    server.close(async () => {
      // Give in-flight extractions a chance to finish; anything still running is
      // marked INTERRUPTED on the next boot.
      await Promise.race([jobRunner.onIdle(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS - 2_000))]);
      await db.destroy();
      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

start();
