export function createHealthController({ checkDatabase, logger }) {
  return {
    /** Liveness: the process is up and serving requests. */
    live(_req, res) {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    },

    /** Readiness: dependencies (PostgreSQL) are reachable. */
    async ready(req, res) {
      const startedAt = Date.now();
      try {
        await checkDatabase();
        res.json({ status: 'ready', checks: { database: 'ok' }, latencyMs: Date.now() - startedAt });
      } catch (err) {
        (req.log ?? logger).error({ err }, 'readiness check failed: database unreachable');
        res.status(503).json({ status: 'unavailable', checks: { database: 'unreachable' } });
      }
    },
  };
}
