import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TemplatePickerSheet } from './TemplatePickerSheet.tsx';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import type { EstimateTemplateDetail, EstimateTemplateSummary } from '@/api/types.ts';

vi.mock('@/api/estimateTemplates.ts', () => ({
  estimateTemplatesApi: {
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  },
}));

const own: EstimateTemplateSummary = {
  id: 'own1', name: 'Моя ванна', trade: null, isDefault: false, itemCount: 3,
};
const def: EstimateTemplateSummary = {
  id: 'def1', name: 'Санвузол повний', trade: 'TILING', isDefault: true, itemCount: 8,
};

function renderPicker(onPick: (t: EstimateTemplateSummary) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<TemplatePickerSheet open onClose={() => {}} onPick={onPick} />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplatePickerSheet', () => {
  it('lists my templates and the defaults, and previews → picks one', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, def]);
    const detail: EstimateTemplateDetail = {
      id: 'def1', name: 'Санвузол повний', trade: 'TILING', isDefault: true,
      items: [{ id: 'ti1', name: 'Грунтовка поверхонь', type: 'WORK', unit: 'M2', sortOrder: 0 }],
    };
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(detail);
    const onPick = vi.fn();

    renderPicker(onPick);

    // Both my own and the default template show up.
    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    expect(screen.getByText('Санвузол повний')).toBeTruthy();

    // Open the default's preview → its position is fetched and listed.
    fireEvent.click(screen.getByText('Санвузол повний'));
    expect(await screen.findByText('Грунтовка поверхонь')).toBeTruthy();

    // Confirm → onPick gets the chosen template.
    fireEvent.click(screen.getByRole('button', { name: 'Створити з цього шаблону' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(def));
  });

  it('shows the empty-state hint when there are no own templates', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([def]);
    renderPicker(vi.fn());

    expect(await screen.findByText(/не зберегли жодного шаблону/i)).toBeTruthy();
  });
});
