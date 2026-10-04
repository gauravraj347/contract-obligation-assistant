import { contractIdParams } from '../validators/contract.validators.js';
import { dashboardQuery, scheduleQuery, summaryQuery } from '../validators/reporting.validators.js';

const safeFilename = (title) => title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'contract';

export function createReportingController({ reportingService }) {
  return {
    async dashboard(req, res) {
      const query = dashboardQuery.parse(req.query);
      res.json(await reportingService.getDashboard(query));
    },

    async schedule(req, res) {
      const { contractId } = contractIdParams.parse(req.params);
      const { asOf } = scheduleQuery.parse(req.query);
      res.json(await reportingService.getSchedule(contractId, { asOf }));
    },

    async summary(req, res) {
      const { contractId } = contractIdParams.parse(req.params);
      const { asOf, format } = summaryQuery.parse(req.query);
      const summary = await reportingService.getSummary(contractId, { asOf });
      if (format === 'markdown') {
        res
          .type('text/markdown; charset=utf-8')
          .attachment(`${safeFilename(summary.contract.title)}-v${summary.contract.versionNumber}-summary.md`)
          .send(summary.markdown);
        return;
      }
      res.json({ summary });
    },
  };
}
