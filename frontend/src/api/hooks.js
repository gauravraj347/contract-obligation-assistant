import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { localToday } from '../utils/format.js';
import { apiRequest } from './client.js';

export const keys = {
  contracts: ['contracts'],
  contract: (id) => ['contract', id],
  review: (id) => ['contract', id, 'review'],
  schedule: (id) => ['contract', id, 'schedule'],
  summary: (id) => ['contract', id, 'summary'],
  version: (id) => ['version', id],
  runs: (versionId) => ['version', versionId, 'runs'],
  dashboard: (windowDays) => ['dashboard', windowDays],
};

const ACTIVE = new Set(['queued', 'running']);

export const useContracts = () =>
  useQuery({ queryKey: keys.contracts, queryFn: ({ signal }) => apiRequest('/api/contracts', { signal }).then((r) => r.contracts) });

export const useContract = (id) =>
  useQuery({ queryKey: keys.contract(id), queryFn: ({ signal }) => apiRequest(`/api/contracts/${id}`, { signal }) });

export const useContractReview = (id) =>
  useQuery({ queryKey: keys.review(id), queryFn: ({ signal }) => apiRequest(`/api/contracts/${id}/items`, { signal }) });

export const useVersion = (versionId, { enabled = true } = {}) =>
  useQuery({
    queryKey: keys.version(versionId),
    queryFn: ({ signal }) => apiRequest(`/api/versions/${versionId}`, { signal }),
    enabled: Boolean(versionId) && enabled,
    staleTime: Infinity, // version text never changes
  });

export const useSchedule = (id) =>
  useQuery({
    queryKey: keys.schedule(id),
    queryFn: ({ signal }) => apiRequest(`/api/contracts/${id}/schedule?asOf=${localToday()}`, { signal }),
  });

export const useSummary = (id) =>
  useQuery({
    queryKey: keys.summary(id),
    queryFn: ({ signal }) => apiRequest(`/api/contracts/${id}/summary?asOf=${localToday()}`, { signal }).then((r) => r.summary),
  });

export const useDashboard = (windowDays) =>
  useQuery({
    queryKey: keys.dashboard(windowDays),
    queryFn: ({ signal }) => apiRequest(`/api/dashboard?asOf=${localToday()}&windowDays=${windowDays}`, { signal }),
  });

/** Everything derived from item review state; invalidated after any review action. */
function invalidateContractData(queryClient, contractId) {
  queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: keys.contracts });
}

/**
 * Extraction runs for a version. Polls every 2s while the latest run is queued/running,
 * and refreshes the review data when a run finishes.
 */
export function useExtractionRuns(versionId, contractId) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.runs(versionId),
    queryFn: ({ signal }) => apiRequest(`/api/versions/${versionId}/extractions`, { signal }).then((r) => r.runs),
    enabled: Boolean(versionId),
    refetchInterval: (q) => (ACTIVE.has(q.state.data?.[0]?.status) ? 2000 : false),
  });

  const latestStatus = query.data?.[0]?.status;
  const previous = useRef(latestStatus);
  useEffect(() => {
    if (ACTIVE.has(previous.current) && latestStatus && !ACTIVE.has(latestStatus)) {
      invalidateContractData(queryClient, contractId);
    }
    previous.current = latestStatus;
  }, [latestStatus, contractId, queryClient]);

  return query;
}

export function useStartExtraction(versionId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`/api/versions/${versionId}/extractions`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.runs(versionId) }),
  });
}

export function useCreateContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData) => apiRequest('/api/contracts', { method: 'POST', formData }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.contracts }),
  });
}

export function useAddVersion(contractId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData) => apiRequest(`/api/contracts/${contractId}/versions`, { method: 'POST', formData }),
    onSuccess: () => invalidateContractData(queryClient, contractId),
  });
}

/** approve | reject | reopen | edit on one item. */
export function useItemAction(contractId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, action, body }) =>
      action === 'edit'
        ? apiRequest(`/api/items/${itemId}`, { method: 'PATCH', body })
        : apiRequest(`/api/items/${itemId}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: () => invalidateContractData(queryClient, contractId),
  });
}
