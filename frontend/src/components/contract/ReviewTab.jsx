import { useState } from 'react';
import { useContractReview } from '../../api/hooks.js';
import { ITEM_TYPE_LABELS, ITEM_TYPE_ORDER, plural } from '../../utils/format.js';
import { ItemCard } from '../review/ItemCard.jsx';
import { QueryState } from '../StatusViews.jsx';

const FILTERS = ['all', 'pending', 'approved', 'rejected'];

function ReviewProgress({ counts }) {
  const decided = counts.approved + counts.rejected;
  const percent = counts.total ? Math.round((decided / counts.total) * 100) : 0;
  return (
    <div className="progress" aria-label={`${decided} of ${counts.total} items reviewed`}>
      <div className="progress__bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="small">
        {decided}/{counts.total} reviewed · {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
      </span>
    </div>
  );
}

export function ReviewTab({ contractId }) {
  const review = useContractReview(contractId);
  const [filter, setFilter] = useState('all');

  return (
    <QueryState query={review} loadingLabel="Loading extracted items…">
      {(data) => {
        const visible = filter === 'all' ? data.items : data.items.filter((item) => item.status === filter);
        const staleItems = data.carriedOverItems.filter((item) => item.potentiallyStale);
        const groups = ITEM_TYPE_ORDER.map((type) => [type, visible.filter((item) => item.itemType === type)]).filter(
          ([, items]) => items.length > 0,
        );

        return (
          <div className="review">
            {staleItems.length > 0 && (
              <section className="review__stale">
                <h3>Approved items from earlier versions — {plural(staleItems.length, 'item')} to re-check</h3>
                <p className="muted">
                  A new version was uploaded after these were approved. Confirm each is still valid, or dismiss it.
                </p>
                {staleItems.map((item) => (
                  <ItemCard key={item.id} item={item} contractId={contractId} />
                ))}
              </section>
            )}

            <h3>Version {data.latestVersion.versionNumber} items</h3>
            {data.items.length === 0 ? (
              <div className="state state--empty">
                <p>No extracted items for this version yet. They appear once the AI extraction succeeds.</p>
              </div>
            ) : (
              <>
                <ReviewProgress counts={data.counts.current} />
                <div className="filters" role="group" aria-label="Filter by status">
                  {FILTERS.map((f) => (
                    <button key={f} type="button" className={filter === f ? 'chip is-active' : 'chip'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({f === 'all' ? data.counts.current.total : data.counts.current[f]})
                    </button>
                  ))}
                </div>
                {groups.length === 0 && <p className="muted">No {filter} items.</p>}
                {groups.map(([type, items]) => (
                  <section key={type} className="review__group">
                    <h4 className="review__group-title">
                      {ITEM_TYPE_LABELS[type]} <span className="muted">({items.length})</span>
                    </h4>
                    {items.map((item) => (
                      <ItemCard key={item.id} item={item} contractId={contractId} />
                    ))}
                  </section>
                ))}
              </>
            )}

            {data.carriedOverItems.some((item) => !item.potentiallyStale) && (
              <details className="review__carried">
                <summary>Reconfirmed items from earlier versions ({data.carriedOverItems.filter((i) => !i.potentiallyStale).length})</summary>
                {data.carriedOverItems
                  .filter((item) => !item.potentiallyStale)
                  .map((item) => (
                    <ItemCard key={item.id} item={item} contractId={contractId} />
                  ))}
              </details>
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
