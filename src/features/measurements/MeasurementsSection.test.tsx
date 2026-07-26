import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { MeasurementsSection } from './MeasurementsSection.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { measurementsApi } from '@/api/measurements.ts';
import type { MeasurementsResponse, Trade, UserResponse } from '@/api/types.ts';

vi.mock('@/api/measurements.ts', () => ({
  measurementsApi: {
    tree: vi.fn(),
    addRoom: vi.fn(),
    updateRoom: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    deleteRoom: vi.fn(),
    deleteItem: vi.fn(),
  },
}));

// One normal room (areas) + the electrical bucket (points + chase) — the electrical rows
// must land in the «⚡ Електрика» block, never in the «площі» room list.
const tree: MeasurementsResponse = {
  areaTotal: 30,
  linearTotal: 17,
  pieceTotal: 28,
  rooms: [
    {
      id: 'r1', name: 'Спальня', floor: null, sortOrder: 0, areaTotal: 30, linearTotal: 5, pieceTotal: 0,
      items: [
        { id: 'i1', name: 'Стеля', type: 'SURFACE', unit: 'M2', result: 30, sortOrder: 0, payload: { segments: [], openings: [] } },
        { id: 'i3', name: 'Відкоси', type: 'LINEAR', unit: 'LINEAR_METER', result: 5, sortOrder: 1, payload: { height: 0, width: 0, sides: { left: true, right: true, top: true, bottom: false }, qty: 1 } },
      ],
    },
    {
      id: 're', name: 'Електрика', floor: null, sortOrder: 1, areaTotal: 0, linearTotal: 12, pieceTotal: 28,
      items: [
        { id: 'e1', name: 'Точки з плану', type: 'ELECTRICAL_POINTS', unit: 'PIECE', result: 28, sortOrder: 0, payload: { points: [] } },
        { id: 'e2', name: 'Штроба · кухня', type: 'SHTROBA', unit: 'LINEAR_METER', result: 12, sortOrder: 1, payload: { busLevel: 2600, busFromTop: true, busLength: 1000, busChase: true, reservePct: 10, points: [] } },
        { id: 'e3', name: 'Кабель · кухня', type: 'CABLE', unit: 'M', result: 15, sortOrder: 2, payload: { busLevel: 2600, busFromTop: true, busLength: 1000, busChase: true, reservePct: 10, points: [] } },
      ],
    },
  ],
};

const baseMe: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'PRO', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'r1',
};

function renderSection(trades: Trade[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, { ...baseMe, trades });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<MeasurementsSection objectId="p1" />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measurementsApi.tree).mockResolvedValue(tree);
});

describe('MeasurementsSection — площі vs ⚡ Електрика', () => {
  // ⚡ Електрика is parked (ELECTRICAL_MEASUREMENTS_ENABLED=false): the block is hidden even
  // for electricians, and electrical items must NOT leak into the площі block.
  it('electrician: площі shows; the parked ⚡ block is hidden and electrical rows do not leak', async () => {
    renderSection(['ELECTRICAL']);

    expect(await screen.findByText('Кімнати · площі')).toBeTruthy();
    expect(screen.getByText('Спальня')).toBeTruthy();

    expect(screen.queryByText('⚡ Електрика')).toBeNull();
    expect(screen.queryByText('Точки з плану')).toBeNull();
    expect(screen.queryByText('Штроба · кухня')).toBeNull();
    expect(screen.queryByText('Кабель · кухня')).toBeNull();
  });

  it('non-electrician: no ⚡ Електрика block, no electrical rows in площі', async () => {
    renderSection(['TILING']);

    expect(await screen.findByText('Кімнати · площі')).toBeTruthy();
    expect(screen.queryByText('⚡ Електрика')).toBeNull();
    expect(screen.queryByText('Штроба · кухня')).toBeNull();
    expect(screen.queryByText('Кабель · кухня')).toBeNull();
  });

  it('tapping a room name opens a rename dialog and saves name + floor', async () => {
    vi.mocked(measurementsApi.updateRoom).mockResolvedValue(tree);
    renderSection(['TILING']);

    // Tap the room name (was: only 🗑 — no way to fix a typo).
    fireEvent.click(await screen.findByText(/Спальня/));
    const nameInput = await screen.findByDisplayValue('Спальня');
    fireEvent.change(nameInput, { target: { value: 'Спальня велика' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(measurementsApi.updateRoom).toHaveBeenCalledWith(
      'p1', 'r1', { name: 'Спальня велика', floor: null },
    ));
  });
});
