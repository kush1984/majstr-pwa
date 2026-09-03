import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { DictationSheet } from './DictationSheet.tsx';
import { dictationApi } from '@/api/dictation.ts';
import { toast } from '@/hooks/useToast.ts';
import type { DictationItem } from '@/api/types.ts';

vi.mock('@/api/dictation.ts', () => ({
  dictationApi: { parse: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function item(over: Partial<DictationItem> = {}): DictationItem {
  return {
    name: 'Поклейка шпалер',
    spokenName: 'поклеїти шпалери',
    unit: 'M2',
    quantity: 20,
    unitPrice: 150,
    type: 'WORK',
    category: 'Шпалери',
    catalogItemId: 'c1',
    issues: [],
    ...over,
  };
}

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<DictationSheet open onClose={() => {}} estimateId="e1" />, { wrapper });
}

/** Type text into the field and run the parse. */
async function dictate(text = 'поклеїти шпалери двадцять квадратів') {
  fireEvent.change(screen.getByLabelText('Текст із позиціями'), { target: { value: text } });
  fireEvent.click(screen.getByText('Розпізнати'));
  await waitFor(() => expect(screen.getByText(/Перевірте позиції|не знайдено позицій/)).toBeTruthy());
}

beforeEach(() => vi.clearAllMocks());

describe('DictationSheet', () => {
  it('turns the spoken text into an editable review and appends only what is ticked', async () => {
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [item(), item({ name: 'Монтаж плінтуса', spokenName: 'монтаж плінтуса',
        unit: 'M', quantity: 18, unitPrice: 90, catalogItemId: 'c2', category: null })],
    });
    vi.mocked(dictationApi.commit).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof dictationApi.commit>>);

    renderSheet();
    await dictate();

    expect(dictationApi.parse).toHaveBeenCalledWith('e1', 'поклеїти шпалери двадцять квадратів');
    expect(screen.getByDisplayValue('Поклейка шпалер')).toBeTruthy();

    // Drop the second row — the review is a decision, not a preview.
    fireEvent.click(screen.getAllByLabelText('Прибрати рядок')[1]);
    fireEvent.click(screen.getByText(/^Додати 1/));

    await waitFor(() => expect(dictationApi.commit).toHaveBeenCalled());
    expect(vi.mocked(dictationApi.commit).mock.calls[0][1]).toEqual([
      { name: 'Поклейка шпалер', unit: 'M2', quantity: 20, unitPrice: 150, type: 'WORK', category: null },
    ]);
  });

  it('says plainly that a position is not in the catalog, and leaves its price empty', async () => {
    // The rule the whole flow hangs on: an unmatched position must never arrive silently priced
    // at 0 ₴. The server flags it, and this screen is where the master sees the flag.
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [item({ name: 'демонтаж старої плитки', spokenName: 'демонтаж старої плитки',
        unitPrice: null, catalogItemId: null, category: null, issues: ['catalog', 'price'] })],
    });

    renderSheet();
    await dictate('демонтаж старої плитки 12 квадратів');

    expect(screen.getByText('Немає у вашому каталозі — впишіть ціну')).toBeTruthy();
    expect(screen.getByPlaceholderText('₴')).toHaveProperty('value', '');
    expect(screen.getByText(/Позицій без ціни: 1/)).toBeTruthy();
    // Not a block: he may price it in the estimate later, so «Додати» stays live.
    expect(screen.getByText(/^Додати 1/).hasAttribute('disabled')).toBe(false);
  });

  it('shows what he actually said when the catalog answered with a different wording', async () => {
    vi.mocked(dictationApi.parse).mockResolvedValue({ items: [item()] });

    renderSheet();
    await dictate();

    expect(screen.getByText('Сказано: поклеїти шпалери')).toBeTruthy();
  });

  it('blocks the commit while a row has no unit, since the estimate line cannot carry one', async () => {
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [item({ unit: null, issues: ['unit'] })],
    });

    renderSheet();
    await dictate();

    expect(screen.getByText(/^Додати 1/).hasAttribute('disabled')).toBe(true);
  });

  it('keeps his text on a failed read instead of making him say it again', async () => {
    vi.mocked(dictationApi.parse).mockRejectedValue(new Error('boom'));

    renderSheet();
    const field = screen.getByLabelText('Текст із позиціями');
    fireEvent.change(field, { target: { value: 'поклеїти шпалери 20 квадратів' } });
    fireEvent.click(screen.getByText('Розпізнати'));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText('Текст із позиціями')).toHaveProperty(
      'value', 'поклеїти шпалери 20 квадратів');
  });

  it('offers the way back to the text when nothing was recognized', async () => {
    vi.mocked(dictationApi.parse).mockResolvedValue({ items: [] });

    renderSheet();
    await dictate('добрий день');

    fireEvent.click(screen.getByText('Повернутись до тексту'));
    expect(screen.getByText('Розпізнати')).toBeTruthy();
  });
});
