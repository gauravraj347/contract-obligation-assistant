import { useParams, useSearchParams } from 'react-router';
import { useContract } from '../api/hooks.js';
import { ReviewTab } from '../components/contract/ReviewTab.jsx';
import { ScheduleTab } from '../components/contract/ScheduleTab.jsx';
import { SummaryTab } from '../components/contract/SummaryTab.jsx';
import { VersionsTab } from '../components/contract/VersionsTab.jsx';
import { ExtractionStatus } from '../components/ExtractionStatus.jsx';
import { QueryState } from '../components/StatusViews.jsx';
import { formatDateTime } from '../utils/format.js';

const TABS = [
  ['review', 'Review items'],
  ['schedule', 'Deadlines & reminders'],
  ['summary', 'Reviewed summary'],
  ['versions', 'Versions'],
];

export function ContractPage() {
  const { contractId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'review';
  const contract = useContract(contractId);

  return (
    <div className="page">
      <QueryState query={contract} loadingLabel="Loading contract…">
        {(data) => {
          const latest = data.versions[0];
          return (
            <>
              <div className="page__head">
                <div>
                  <h1>{data.title}</h1>
                  <p className="muted small">
                    Version {latest.versionNumber} of {data.versions.length} · uploaded {formatDateTime(latest.createdAt)}
                  </p>
                </div>
              </div>

              <ExtractionStatus versionId={latest.id} contractId={data.id} />

              <nav className="tabs" role="tablist" aria-label="Contract sections">
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? 'tab is-active' : 'tab'}
                    onClick={() => setParams({ tab: key }, { replace: true })}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div role="tabpanel">
                {tab === 'review' && <ReviewTab contractId={data.id} />}
                {tab === 'schedule' && <ScheduleTab contractId={data.id} />}
                {tab === 'summary' && <SummaryTab contractId={data.id} />}
                {tab === 'versions' && <VersionsTab contract={data} onUploaded={() => setParams({ tab: 'review' })} />}
              </div>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
