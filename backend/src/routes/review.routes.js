import { Router } from 'express';

export function itemRoutes(controller) {
  const router = Router();
  router.get('/:itemId', controller.getItem);
  router.patch('/:itemId', controller.editItem);
  router.post('/:itemId/approve', controller.approve);
  router.post('/:itemId/reject', controller.reject);
  router.post('/:itemId/reopen', controller.reopen);
  return router;
}
