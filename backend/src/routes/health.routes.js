import { Router } from 'express';

export function healthRoutes(controller) {
  const router = Router();
  router.get('/', controller.live);
  router.get('/ready', controller.ready);
  return router;
}
