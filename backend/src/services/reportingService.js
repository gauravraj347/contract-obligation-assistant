import * as contracts from '../models/contract.model.js';
import * as items from '../models/extractedItem.model.js';
import * as versions from '../models/contractVersion.model.js';
import { NotFoundError } from '../utils/errors.js';
import { addDays } from './dateEngine.js';
import { buildSchedule, tierOf } from './scheduleBuilder.js';
import { buildSummary } from './summaryBuilder.js';

/** Schedules, dashboard and reviewed summary. All dates come from approved items via deterministic code. */
export function createReportingService({ db, logger, now = () => new Date() }) {
  const log = logger.child({ component: 'reportingService' });

  async function loadContract(contractId) {
    const contract = await contracts.findContractById(db, contractId);
    if (!contract) throw new NotFoundError('Contract not found');
    const latestVersion = await versions.findLatestVersion(db, contractId);
    const approved = await items.listApprovedItems(db, { contractId });
    const approvedItems = approved.map((item) => ({ ...item, tier: tierOf(item, latestVersion.id) }));
    return { contract, latestVersion, approvedItems };
  }

  async function getSchedule(contractId, { asOf }) {
    const { contract, latestVersion, approvedItems } = await loadContract(contractId);
    return {
      contractId: contract.id,
      versionNumber: latestVersion.versionNumber,
      ...buildSchedule(approvedItems, { asOf }),
    };
  }

  async function getSummary(contractId, { asOf }) {
    const { contract, latestVersion, approvedItems } = await loadContract(contractId);
    const workspace = await items.listItemsForContractReview(db, { contractId, latestVersionId: latestVersion.id });
    const current = workspace.filter((item) => item.contractVersionId === latestVersion.id);
    const reviewCounts = {
      approved: approvedItems.length,
      pending: current.filter((item) => item.status === 'pending').length,
      rejected: current.filter((item) => item.status === 'rejected').length,
      potentiallyStale: approvedItems.filter((item) => item.tier === 'stale').length,
    };
    const schedule = buildSchedule(approvedItems, { asOf });
    const summary = buildSummary({
      contract,
      latestVersion,
      approvedItems,
      reviewCounts,
      schedule,
      generatedAt: now().toISOString(),
    });
    log.info(
      { event: 'summary.generated', contractId, versionNumber: latestVersion.versionNumber, approvedItems: approvedItems.length, complete: summary.reviewStatus.complete },
      'summary generated',
    );
    return summary;
  }

  /**
   * Upcoming obligations and renewal deadlines across all contracts within ±windowDays of asOf.
   * Overdue items older than the window are omitted so long-expired terms don't flood the view.
   */
  async function getDashboard({ asOf, windowDays }) {
    const [contractRows, approved, reviewQueue] = await Promise.all([
      contracts.listContracts(db),
      items.listApprovedItems(db),
      items.countReviewQueue(db),
    ]);

    const latestVersionIds = await db('contractVersions as v')
      .select('v.contractId', 'v.id')
      .whereRaw('v.version_number = (select max(version_number) from contract_versions where contract_id = v.contract_id)');
    const latestByContract = new Map(latestVersionIds.map((row) => [row.contractId, row.id]));
    const titles = new Map(contractRows.map((row) => [row.id, row.title]));

    const byContract = new Map();
    for (const item of approved) {
      const tiered = { ...item, tier: tierOf(item, latestByContract.get(item.contractId)) };
      if (!byContract.has(item.contractId)) byContract.set(item.contractId, []);
      byContract.get(item.contractId).push(tiered);
    }

    const from = addDays(asOf, -windowDays);
    const to = addDays(asOf, windowDays);
    const deadlines = [];
    const unscheduled = [];
    for (const [contractId, contractItems] of byContract) {
      const schedule = buildSchedule(contractItems, { asOf });
      const contractTitle = titles.get(contractId);
      for (const deadline of schedule.deadlines) {
        if (deadline.date >= from && deadline.date <= to) deadlines.push({ ...deadline, contractId, contractTitle });
      }
      for (const entry of schedule.unscheduled.filter((u) => u.itemType === 'obligation')) {
        unscheduled.push({ ...entry, contractId, contractTitle });
      }
    }
    deadlines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      asOf,
      windowDays,
      counts: {
        contracts: contractRows.length,
        overdue: deadlines.filter((d) => d.status === 'overdue').length,
        dueSoon: deadlines.filter((d) => d.status === 'due_soon').length,
        upcoming: deadlines.filter((d) => d.status === 'upcoming').length,
        renewalDeadlines: deadlines.filter((d) => d.kind === 'renewal_deadline' || d.kind === 'term_end').length,
        ...reviewQueue,
      },
      deadlines,
      unscheduledObligations: unscheduled,
    };
  }

  return { getSchedule, getSummary, getDashboard };
}
