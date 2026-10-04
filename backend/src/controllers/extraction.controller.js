import { z } from 'zod';
import { versionIdParams } from '../validators/contract.validators.js';

const runIdParams = z.object({ runId: z.uuid('runId must be a valid id') });

export function createExtractionController({ extractionService }) {
  return {
    /** Start (or retry after failure) an extraction. 202: work continues in the background. */
    async start(req, res) {
      const { versionId } = versionIdParams.parse(req.params);
      const run = await extractionService.startExtraction(versionId);
      res.status(202).json({ run });
    },

    async listRuns(req, res) {
      const { versionId } = versionIdParams.parse(req.params);
      res.json({ runs: await extractionService.listRuns(versionId) });
    },

    async getRun(req, res) {
      const { runId } = runIdParams.parse(req.params);
      res.json({ run: await extractionService.getRun(runId) });
    },

    async listItems(req, res) {
      const { versionId } = versionIdParams.parse(req.params);
      res.json({ items: await extractionService.listItems(versionId) });
    },
  };
}
