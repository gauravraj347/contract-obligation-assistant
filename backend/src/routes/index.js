import { Router } from 'express';
import { createContractController } from '../controllers/contract.controller.js';
import { createExtractionController } from '../controllers/extraction.controller.js';
import { createHealthController } from '../controllers/health.controller.js';
import { createReportingController } from '../controllers/reporting.controller.js';
import { createReviewController } from '../controllers/review.controller.js';
import { contractRoutes, extractionRoutes, versionRoutes } from './contract.routes.js';
import { healthRoutes } from './health.routes.js';
import { itemRoutes } from './review.routes.js';

/** Mounts all API routes. Dependencies are injected so routes are testable without a real DB. */
export function apiRoutes({ checkDatabase, logger, services }) {
  const router = Router();
  const contractController = createContractController(services);
  const extractionController = createExtractionController(services);
  const reviewController = createReviewController(services);
  const reportingController = createReportingController(services);

  router.use('/health', healthRoutes(createHealthController({ checkDatabase, logger })));
  router.get('/dashboard', reportingController.dashboard);
  router.use('/contracts', contractRoutes(contractController, reviewController, reportingController));
  router.use('/versions', versionRoutes(contractController, extractionController));
  router.use('/extractions', extractionRoutes(extractionController));
  router.use('/items', itemRoutes(reviewController));
  return router;
}
