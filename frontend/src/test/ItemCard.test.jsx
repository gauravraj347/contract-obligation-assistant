import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../App.jsx';
import { buildEditPatch } from '../components/review/EditItemForm.jsx';
import { ItemCard } from '../components/review/ItemCard.jsx';
import { ToastProvider } from '../components/Toast.jsx';

const baseItem = (overrides = {}) => ({
  id: 'item-1',
  contractVersionId: 'v1',
  itemType: 'renewal',
  label: 'Non-renewal notice',
  status: 'pending',
  certainty: 'confirmed',
  certaintyReason: 'Stated explicitly.',
  isEdited: false,
  potentiallyStale: false,
  staleReason: null,
  responsibleParty: 'Customer',
  clarificationQuestion: null,
  aiValue: { summary: '60 days notice', date: null, dateRule: null, period: { length: 60, unit: 'days' }, autoRenews: true, recurrence: null },
  currentValue: { summary: '60 days notice', date: null, dateRule: null, period: { length: 60, unit: 'days' }, autoRenews: true, recurrence: null },
  citations: [{ id: 'c1', sectionId: 's1', sectionRef: '2.1', documentRole: 'contract', quote: 'unless either party gives 60 days notice', verified: true }],
  ...overrides,
});

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ item: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderCard(item) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <ItemCard item={item} contractId="contract-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1);
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
};

describe('ItemCard', () => {
  it('shows the item with its citation and approves a verified item in one click', async () => {
    renderCard(baseItem());
    expect(screen.getByText('60 days notice')).toBeInTheDocument();
    expect(screen.getByText('§2.1')).toBeInTheDocument();
    expect(screen.getByText('Quote verified')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastCall()).toEqual({ url: '/api/items/item-1/approve', method: 'POST', body: {} });
    expect(await screen.findByText('Item approved')).toBeInTheDocument();
  });

  it('requires a note before approving an item whose quote could not be verified', async () => {
    const item = baseItem({ citations: [{ ...baseItem().citations[0], verified: false }] });
    renderCard(item);
    expect(screen.getByText('Unverified quote')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole('button', { name: 'Approve' }).at(-1);
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'Checked clause 2.1 by hand');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastCall().body).toEqual({ note: 'Checked clause 2.1 by hand' });
  });

  it('offers reconfirm/dismiss for potentially stale approved items and shows the reason', async () => {
    renderCard(baseItem({ status: 'approved', potentiallyStale: true, staleReason: 'Version 2 uploaded; §2.1 text changed.' }));
    expect(screen.getByText(/§2.1 text changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm still valid' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastCall().url).toBe('/api/items/item-1/approve');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('shows an API failure inline', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'INVALID_TRANSITION', message: 'Cannot approve an item that is approved', requestId: 'r1' } }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderCard(baseItem());
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot approve an item that is approved');
  });
});

describe('buildEditPatch', () => {
  const form = (overrides = {}) => ({
    label: 'Non-renewal notice',
    summary: '60 days notice',
    responsibleParty: 'Customer',
    clarificationQuestion: '',
    date: '',
    hasRule: false,
    rule: { offset: 30, unit: 'days', direction: 'before', anchor: 'expiry_date' },
    hasPeriod: true,
    period: { length: 60, unit: 'days' },
    autoRenews: 'true',
    recurrence: '',
    note: '',
    ...overrides,
  });

  it('sends only changed fields', () => {
    const { patch, errors } = buildEditPatch(baseItem(), form({ period: { length: '90', unit: 'days' }, responsibleParty: '', note: 'Amendment' }));
    expect(errors).toEqual({});
    expect(patch).toEqual({ responsibleParty: null, value: { period: { length: 90, unit: 'days' } }, note: 'Amendment' });
  });

  it('reports no-op edits and invalid numbers', () => {
    expect(buildEditPatch(baseItem(), form()).errors).toEqual({ form: 'Nothing has changed' });
    expect(buildEditPatch(baseItem(), form({ hasRule: true, rule: { offset: '-1', unit: 'days', direction: 'before', anchor: 'expiry_date' } })).errors.rule).toMatch(
      /whole number/,
    );
  });
});
