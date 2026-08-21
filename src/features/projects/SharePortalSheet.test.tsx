import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SharePortalSheet } from './SharePortalSheet.tsx';
import { portalApi, economyPortalApi, estimateShareApi } from '@/api/portal.ts';
import type { PortalStateResponse, ProjectResponse } from '@/api/types.ts';
import { asInput } from '@/test/dom.ts';

vi.mock('@/api/portal.ts', () => ({
  portalApi: { state: vi.fn(), update: vi.fn(), sendEmail: vi.fn() },
  economyPortalApi: { state: vi.fn(), update: vi.fn(), sendEmail: vi.fn() },
  estimateShareApi: { create: vi.fn(), sendEmail: vi.fn() },
}));
vi.mock('@/features/clients/useClients.ts', () => ({
  useClient: () => ({ data: { id: 'c1', fullName: 'Клієнт', phone: '+380', email: 'client@x.ua' } }),
  useCreateClient: () => ({ isPending: false }),
  useUpdateClient: () => ({ isPending: false }),
}));
vi.mock('@/features/projects/useProjects.ts', () => ({
  useUpdateProject: () => ({ isPending: false }),
}));
vi.mock('@/features/clients/ClientPicker.tsx', () => ({
  ClientPicker: () => null,
  clientDraftError: () => null,
  resolveClientId: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

const project = {
  id: 'p1', name: 'Квартира', address: 'вул. Тестова 1', clientId: 'c1',
} as ProjectResponse;

// Non-SIGNED estimates — the shape the SIGNATURE (mode: 'portal') picker filters to.
const state: PortalStateResponse = {
  url: 'https://majstr.pro/portal/index.html?p=tok',
  estimates: [
    { id: 'e1', name: 'Економ', status: 'SENT', createdAt: '2026-07-01T00:00:00Z', visible: true },
    { id: 'e2', name: 'Преміум', status: 'DRAFT', createdAt: '2026-07-02T00:00:00Z', visible: false },
  ],
  paymentsVisible: false,
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** Object-level share — the master picks a set onto the OBJECT's portal link. */
function renderSheet(mode: 'portal' | 'economy' = 'portal') {
  render(
    <SharePortalSheet open onClose={() => {}} project={project}
      onNeedEmailVerify={() => {}} mode={mode} />,
    { wrapper: wrapper() },
  );
}

/** Single-estimate share — mints that ESTIMATE's own link, object portal untouched. */
function renderSingle(estimateId: string, onNeedEmailVerify: () => void = () => {}) {
  render(
    <SharePortalSheet open onClose={() => {}} project={project}
      singleEstimateId={estimateId} onNeedEmailVerify={onNeedEmailVerify} />,
    { wrapper: wrapper() },
  );
}

const shareLink = {
  id: 'l1', token: 'tok-e2', url: 'https://majstr.pro/portal/index.html?t=tok-e2',
  createdAt: '2026-07-02T00:00:00Z', expiresAt: null, revoked: false,
};

describe("SharePortalSheet — mode: 'portal' (Кошторис tab)", () => {
  it('seeds the checkboxes from the server visibility state, with no payments toggle', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    renderSheet();

    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());
    const boxes = screen.getAllByRole('checkbox');
    // Two estimate checkboxes only — SIGNATURE never has a payments card.
    expect(boxes.map((b) => asInput(b).checked)).toEqual([true, false]);
    expect(screen.queryByText('Показувати платежі клієнту')).toBeNull();
  });

  it('publishes exactly the ticked set before copying the link, via the SIGNATURE endpoint', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    vi.mocked(portalApi.update).mockResolvedValue(state);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Преміум')).toBeTruthy());

    // Tick «Преміум» in addition to the already-visible «Економ».
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(portalApi.update).toHaveBeenCalled());
    const ids = vi.mocked(portalApi.update).mock.calls[0][1];
    expect([...ids].sort()).toEqual(['e1', 'e2']);
    expect(economyPortalApi.update).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(state.url);
  });

  it("shared from one estimate: mints that estimate's own link, object portal never even read", async () => {
    vi.mocked(estimateShareApi.create).mockResolvedValue(shareLink);
    renderSingle('e2');

    expect(await screen.findByDisplayValue(shareLink.url)).toBeTruthy();
    expect(estimateShareApi.create).toHaveBeenCalledWith('e2');
    // No picker — and no set to seed one from, so the object's portal state isn't fetched at all.
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(portalApi.state).not.toHaveBeenCalled();
    expect(economyPortalApi.state).not.toHaveBeenCalled();
    expect(screen.getByText(/клієнт побачить лише його/)).toBeTruthy();
    expect(screen.queryByText(/Оберіть кошториси/)).toBeNull();
  });

  it('shared from one estimate: copying publishes nothing onto the object link', async () => {
    vi.mocked(estimateShareApi.create).mockResolvedValue(shareLink);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSingle('e2');
    await screen.findByDisplayValue(shareLink.url);

    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shareLink.url));
    // The whole point of the separate link: what the object's portal shows is left alone.
    expect(portalApi.update).not.toHaveBeenCalled();
    expect(economyPortalApi.update).not.toHaveBeenCalled();
  });

  it("shared from one estimate: email goes out on the estimate's link, not the object's", async () => {
    vi.mocked(estimateShareApi.create).mockResolvedValue(shareLink);
    vi.mocked(estimateShareApi.sendEmail).mockResolvedValue(shareLink);
    renderSingle('e2');
    await screen.findByDisplayValue(shareLink.url);

    fireEvent.click(screen.getByRole('button', { name: /Надіслати на/ }));

    await waitFor(() => expect(estimateShareApi.sendEmail).toHaveBeenCalledWith('e2'));
    expect(portalApi.sendEmail).not.toHaveBeenCalled();
    expect(portalApi.update).not.toHaveBeenCalled();
  });

  it('shared from one estimate: an unverified contractor bounces to the verify modal', async () => {
    // Minting is what trips the gate here, so a failed mint must land where a failed publish does.
    vi.mocked(estimateShareApi.create).mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { status: 403, code: 'EMAIL_NOT_VERIFIED', message: 'x' } },
    });
    const onNeedEmailVerify = vi.fn();
    renderSingle('e2', onNeedEmailVerify);

    await waitFor(() => expect(onNeedEmailVerify).toHaveBeenCalled());
  });

  it('unticking everything offers "hide all" instead of copy', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    vi.mocked(portalApi.update).mockResolvedValue({ ...state, estimates: [] });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('checkbox')[0]); // untick the only visible one
    const hideBtn = await screen.findByRole('button', { name: /Прибрати все/ });
    fireEvent.click(hideBtn);

    await waitFor(() => expect(portalApi.update).toHaveBeenCalledWith('p1', []));
  });

  it('shows only non-SIGNED estimates — a SIGNED one that moved to Економіка is excluded', async () => {
    vi.mocked(portalApi.state).mockResolvedValue({
      ...state,
      estimates: [
        { id: 'e1', name: 'Економ', status: 'SENT', createdAt: '2026-07-01T00:00:00Z', visible: true },
        { id: 'e2', name: 'Преміум', status: 'SIGNED', createdAt: '2026-07-02T00:00:00Z', visible: true },
      ],
    });
    renderSheet();

    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());
    expect(screen.queryByText('Преміум')).toBeNull(); // signed — moved to Економіка, not shown here
    // Payments visibility is a signed-contract concern — not offered from this picker.
    expect(screen.queryByText('Показувати платежі клієнту')).toBeNull();
  });

  it('a SIGNED estimate already published from elsewhere stays published, just not shown', async () => {
    vi.mocked(portalApi.state).mockResolvedValue({
      ...state,
      estimates: [
        { id: 'e1', name: 'Економ', status: 'SENT', createdAt: '2026-07-01T00:00:00Z', visible: true },
        { id: 'e2', name: 'Преміум', status: 'SIGNED', createdAt: '2026-07-02T00:00:00Z', visible: true },
      ],
    });
    vi.mocked(portalApi.update).mockResolvedValue(state);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(portalApi.update).toHaveBeenCalled());
    const ids = vi.mocked(portalApi.update).mock.calls[0][1];
    expect([...ids].sort()).toEqual(['e1', 'e2']);
  });

  it('collapses to just the neutral message when everything is already signed — no picker/publish chrome', async () => {
    vi.mocked(portalApi.state).mockResolvedValue({
      ...state,
      estimates: [
        { id: 'e1', name: 'Економ', status: 'SIGNED', createdAt: '2026-07-01T00:00:00Z', visible: true },
      ],
    });
    renderSheet();

    expect(await screen.findByText(/Немає кошторисів, які ще очікують підпису/)).toBeTruthy();
    expect(screen.queryByText('Показувати платежі клієнту')).toBeNull();
    expect(screen.queryByRole('button', { name: /Копіювати посилання/ })).toBeNull();
    expect(screen.queryByText(/Оберіть кошториси/)).toBeNull();
  });

  it('auto-selects the sole pickable estimate when nothing is published yet', async () => {
    vi.mocked(portalApi.state).mockResolvedValue({
      ...state,
      estimates: [
        { id: 'e1', name: 'Економ', status: 'SENT', createdAt: '2026-07-01T00:00:00Z', visible: false },
      ],
    });
    renderSheet();

    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());
    expect(asInput(screen.getAllByRole('checkbox')[0]).checked).toBe(true);
  });

  it('auto-selects the most recently created estimate when several are pickable and none published', async () => {
    vi.mocked(portalApi.state).mockResolvedValue({
      ...state,
      estimates: [
        { id: 'e1', name: 'Старший', status: 'SENT', createdAt: '2026-07-01T00:00:00Z', visible: false },
        { id: 'e2', name: 'Новіший', status: 'DRAFT', createdAt: '2026-07-05T00:00:00Z', visible: false },
      ],
    });
    renderSheet();

    await waitFor(() => expect(screen.getByText('Новіший')).toBeTruthy());
    const boxes = screen.getAllByRole('checkbox');
    // e1 (older) first in list order, e2 (newer) second — only the newer one is pre-ticked.
    expect(boxes.map((b) => asInput(b).checked)).toEqual([false, true]);
  });
});

describe("SharePortalSheet — mode: 'economy' (Економіка tab)", () => {
  const economyState: PortalStateResponse = {
    url: 'https://majstr.pro/portal/index.html?e=tok',
    estimates: [
      { id: 'e1', name: 'Економ', status: 'SIGNED', createdAt: '2026-07-01T00:00:00Z', visible: true },
      { id: 'e2', name: 'Преміум', status: 'DRAFT', createdAt: '2026-07-02T00:00:00Z', visible: false },
    ],
    paymentsVisible: false,
  };

  it('shows only SIGNED estimates plus the payments toggle, seeded off by default', async () => {
    vi.mocked(economyPortalApi.state).mockResolvedValue(economyState);
    renderSheet('economy');

    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());
    expect(screen.queryByText('Преміум')).toBeNull(); // not signed — not shown here
    expect(screen.getByText(/Оберіть підписані кошториси/)).toBeTruthy();
    // Payments visibility is a signed-contract concern — offered here, unlike from Кошторис.
    const boxes = screen.getAllByRole('checkbox');
    // One estimate checkbox (ticked, already visible) + the payments toggle (off by default).
    expect(boxes.map((b) => asInput(b).checked)).toEqual([true, false]);
    expect(screen.getByText('Показувати платежі клієнту')).toBeTruthy();
  });

  it('publishes exactly the ticked set via the ECONOMY endpoint, never the SIGNATURE one', async () => {
    vi.mocked(economyPortalApi.state).mockResolvedValue(economyState);
    vi.mocked(economyPortalApi.update).mockResolvedValue(economyState);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSheet('economy');
    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(economyPortalApi.update).toHaveBeenCalledWith('p1', ['e1'], false));
    expect(portalApi.update).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(economyState.url);
  });

  it('ticking the payments toggle publishes paymentsVisible:true', async () => {
    vi.mocked(economyPortalApi.state).mockResolvedValue(economyState);
    vi.mocked(economyPortalApi.update).mockResolvedValue(economyState);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSheet('economy');
    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('checkbox')[1]); // the payments toggle
    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(economyPortalApi.update).toHaveBeenCalledWith('p1', ['e1'], true));
  });

  it('a not-yet-signed estimate already published from Кошторис stays published, just not shown', async () => {
    // e2 (DRAFT) is visible:true on the server — published earlier from the Кошторис tab. The
    // signed-only picker must not silently drop it from what gets re-published.
    vi.mocked(economyPortalApi.state).mockResolvedValue({
      ...economyState,
      estimates: [
        { id: 'e1', name: 'Економ', status: 'SIGNED', createdAt: '2026-07-01T00:00:00Z', visible: true },
        { id: 'e2', name: 'Преміум', status: 'DRAFT', createdAt: '2026-07-02T00:00:00Z', visible: true },
      ],
    });
    vi.mocked(economyPortalApi.update).mockResolvedValue(economyState);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSheet('economy');
    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(economyPortalApi.update).toHaveBeenCalled());
    const ids = vi.mocked(economyPortalApi.update).mock.calls[0][1];
    expect([...ids].sort()).toEqual(['e1', 'e2']);
  });

  it('a SIGNED estimate shared from its editor gets the same per-estimate link, with no payments toggle', async () => {
    // The payments card belongs to the OBJECT's economy link; a per-estimate link has none, so
    // the toggle must not be offered here — it would have nothing to act on.
    vi.mocked(estimateShareApi.create).mockResolvedValue(shareLink);
    renderSingle('e1');

    await screen.findByDisplayValue(shareLink.url);
    expect(screen.queryByText('Показувати платежі клієнту')).toBeNull();
    expect(economyPortalApi.state).not.toHaveBeenCalled();
    expect(economyPortalApi.update).not.toHaveBeenCalled();
  });

  it('collapses to just the neutral message when nothing is signed yet — no picker/payments/publish chrome', async () => {
    vi.mocked(economyPortalApi.state).mockResolvedValue({ ...economyState, estimates: [] });
    renderSheet('economy');

    expect(await screen.findByText(/Ще немає підписаних кошторисів/)).toBeTruthy();
    expect(screen.queryByText('Показувати платежі клієнту')).toBeNull();
    expect(screen.queryByRole('button', { name: /Копіювати посилання/ })).toBeNull();
    expect(screen.queryByText(/Оберіть підписані кошториси/)).toBeNull();
  });
});
