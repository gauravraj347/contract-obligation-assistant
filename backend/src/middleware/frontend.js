import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

/**
 * Serves the built React app (single-service deployment). Non-API GET requests that
 * accept HTML fall back to index.html so client-side routes work on reload.
 * Returns null when the directory has no build, so the API still runs on its own.
 */
export function frontendMiddleware(distDir) {
  const root = path.resolve(distDir);
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile)) return null;

  const router = express.Router();
  router.use(express.static(root, { index: false, maxAge: '1h' }));
  router.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || !req.accepts('html')) return next();
    res.set('Cache-Control', 'no-cache').sendFile(indexFile);
  });
  return router;
}
