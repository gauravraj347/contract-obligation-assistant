import { Link } from 'react-router';
import { useContracts } from '../api/hooks.js';
import { EmptyState, QueryState } from '../components/StatusViews.jsx';
import { formatDateTime } from '../utils/format.js';

export function ContractsPage() {
  const contracts = useContracts();
  return (
    <div className="page">
      <div className="page__head">
        <h1>Contracts</h1>
        <Link to="/contracts/new" className="button button--primary">
          Upload contract
        </Link>
      </div>
      <QueryState query={contracts} loadingLabel="Loading contracts…">
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No contracts yet" action={{ to: '/contracts/new', label: 'Upload a contract' }}>
              Upload a PDF or DOCX, or paste contract text, to start.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Current version</th>
                    <th>Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/contracts/${c.id}`}>{c.title}</Link>
                      </td>
                      <td>v{c.latestVersionNumber}</td>
                      <td>{formatDateTime(c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
