import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { frontendMiddleware } from './middleware/frontend.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRoutes } from './routes/index.js';

/**
 * Builds the Express app from injected dependencies (no side effects, no listen),
 * so tests can create it with stubs.
 */
export function createApp({ logger, checkDatabase, services, corsOrigins = [], frontendDistDir }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', apiRoutes({ checkDatabase, logger, services }));

  if (frontendDistDir) {
    const frontend = frontendMiddleware(frontendDistDir);
    if (frontend) {
      app.use(frontend);
    } else {
      logger.warn({ frontendDistDir }, 'FRONTEND_DIST_DIR has no index.html; serving the API only');
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
