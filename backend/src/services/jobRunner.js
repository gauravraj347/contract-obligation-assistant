/**
 * Minimal in-process background queue with bounded concurrency.
 * Job state lives in PostgreSQL (extraction_runs), so a restart loses only the
 * in-memory queue; interrupted runs are marked failed on boot and can be retried.
 */
export function createJobRunner({ logger, concurrency = 2 }) {
  const log = logger.child({ component: 'jobRunner' });
  const queue = [];
  let active = 0;
  const idleWaiters = [];

  function settleIdle() {
    if (active === 0 && queue.length === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  function drain() {
    while (active < concurrency && queue.length > 0) {
      const { name, task } = queue.shift();
      active += 1;
      Promise.resolve()
        .then(task)
        .catch((err) => log.error({ err, job: name }, 'background job crashed'))
        .finally(() => {
          active -= 1;
          drain();
          settleIdle();
        });
    }
  }

  return {
    enqueue(name, task) {
      queue.push({ name, task });
      setImmediate(drain);
    },
    /** Resolves when nothing is queued or running (used by tests and graceful shutdown). */
    onIdle() {
      if (active === 0 && queue.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
