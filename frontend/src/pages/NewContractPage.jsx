import { useNavigate } from 'react-router';
import { useCreateContract } from '../api/hooks.js';
import { DocumentForm } from '../components/DocumentForm.jsx';
import { useToast } from '../components/Toast.jsx';

export function NewContractPage() {
  const createContract = useCreateContract();
  const navigate = useNavigate();
  const { notify } = useToast();

  return (
    <div className="page page--narrow">
      <h1>Upload a contract</h1>
      <p className="muted">
        Upload one contract and, optionally, a short organisational policy to compare it against. The AI extracts parties, dates, renewal,
        termination, notice terms and obligations with citations; you then review every item.
      </p>
      <DocumentForm
        mode="create"
        mutation={createContract}
        submitLabel="Upload and extract"
        onSuccess={(result) => {
          notify('Contract uploaded; AI extraction started.');
          navigate(`/contracts/${result.contract.id}`);
        }}
      />
    </div>
  );
}
