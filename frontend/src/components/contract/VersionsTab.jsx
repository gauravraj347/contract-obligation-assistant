import { useAddVersion } from '../../api/hooks.js';
import { formatDateTime, plural } from '../../utils/format.js';
import { DocumentForm } from '../DocumentForm.jsx';
import { useToast } from '../Toast.jsx';

export function VersionsTab({ contract, onUploaded }) {
  const addVersion = useAddVersion(contract.id);
  const { notify } = useToast();

  const handleSuccess = (result) => {
    const stale = result.staleItemCount
      ? ` ${plural(result.staleItemCount, 'approved item')} marked potentially stale.`
      : '';
    notify(`Version ${result.version.versionNumber} uploaded; AI extraction started.${stale}`);
    onUploaded();
  };

  return (
    <div className="versions">
      <h3>Version history</h3>
      <ol className="version-list">
        {contract.versions.map((version) => (
          <li key={version.id}>
            <div>
              <strong>Version {version.versionNumber}</strong>
              {version.versionNumber === contract.versions[0].versionNumber && <span className="muted small"> (current)</span>}
              <span className="muted small"> · {formatDateTime(version.createdAt)}</span>
            </div>
            {version.note && <p className="small">{version.note}</p>}
            <ul className="plain-list small muted">
              {version.documents.map((doc) => (
                <li key={doc.id}>
                  {doc.role === 'policy' ? 'Policy' : 'Contract'}: {doc.originalFilename ?? 'pasted text'} ({doc.sourceType.toUpperCase()},{' '}
                  {doc.charCount.toLocaleString()} characters)
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <h3>Upload a new version</h3>
      <p className="hint">
        Previous versions and all review decisions are preserved. Items approved on earlier versions will be flagged as potentially stale until
        you re-check them.
      </p>
      <DocumentForm mode="version" mutation={addVersion} onSuccess={handleSuccess} submitLabel="Upload new version" />
    </div>
  );
}
