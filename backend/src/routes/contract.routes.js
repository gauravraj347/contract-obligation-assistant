import { Router } from 'express';
import { documentUpload } from '../middleware/upload.js';

export function contractRoutes(controller, reviewController, reportingController) {
  const router = Router();
  router.get('/', controller.list);
  router.post('/', documentUpload, controller.create);
  router.get('/:contractId', controller.get);
  router.post('/:contractId/versions', documentUpload, controller.addVersion);
  router.get('/:contractId/items', reviewController.contractReview);
  router.get('/:contractId/schedule', reportingController.schedule);
  router.get('/:contractId/summary', reportingController.summary);
  return router;
}

export function versionRoutes(contractController, extractionController) {
  const router = Router();
  router.get('/:versionId', contractController.getVersion);
  router.get('/:versionId/extractions', extractionController.listRuns);
  router.post('/:versionId/extractions', extractionController.start);
  router.get('/:versionId/items', extractionController.listItems);
  return router;
}

export function extractionRoutes(extractionController) {
  const router = Router();
  router.get('/:runId', extractionController.getRun);
  return router;
}
