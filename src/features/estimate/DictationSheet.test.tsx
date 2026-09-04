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
  dictationApi: { parse: vi.fn(), commit: vi.fn(), saveSynonym: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// createCatalogItem is invoked only when a row's «save to catalog» tick is ticked; every existing
// test above leaves that tick off, but the mutation still has to resolve for the synonym tests below.
const createCatalogItemMock = vi.fn().mockResolvedValue({ id: 'new-item' });
vi.mock('@/features/catalog/useCatalog.ts', () => ({
  useCreateCatalogItem: () => ({ mutateAsync: createCatalogItemMock, isPending: false }),
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

beforeEach(() => {
  vi.clearAllMocks();
  createCatalogItemMock.mockResolvedValue({ id: 'new-item' });
});

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
    // Blocks — master decision 2026-09-04: empty/0/negative price → nothing is saved.
    expect(screen.getByText(/^Додати 1/).hasAttribute('disabled')).toBe(true);

    // …once the price is typed, the amber «впишіть ціну» hint collapses to a soft «нова позиція»
    // and «Додати» unlocks. This is the direct fix for master feedback «ціна ж є, чому воно її тут
    // згадує».
    fireEvent.change(screen.getByPlaceholderText('₴'), { target: { value: '450' } });
    expect(screen.queryByText('Немає у вашому каталозі — впишіть ціну')).toBeNull();
    expect(screen.getByText('Нова позиція — не з каталогу')).toBeTruthy();
    expect(screen.getByText(/^Додати 1/).hasAttribute('disabled')).toBe(false);
  });

  it('a 0 or negative price also blocks the commit — empty is not the only bad shape', async () => {
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [item()], // matched, priced at 150
    });

    renderSheet();
    await dictate();

    fireEvent.change(screen.getByPlaceholderText('₴'), { target: { value: '0' } });
    expect(screen.getByText(/^Додати 1/).hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('₴'), { target: { value: '-5' } });
    expect(screen.getByText(/^Додати 1/).hasAttribute('disabled')).toBe(true);
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

  it('offers «save to catalog» only on an unmatched row, and DEAD until it has a price', async () => {
    // The rule this tick's absence protects: a 0 ₴ catalog row is exactly what the flagging pass
    // exists to prevent, and saving one HERE would let the NEXT dictation match it and price the
    // line at 0 silently a week later, through a back door.
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [item({ name: 'демонтаж старої плитки', spokenName: 'демонтаж старої плитки',
        unit: 'M2', quantity: 12, unitPrice: null, catalogItemId: null, category: null,
        issues: ['catalog', 'price'] })],
    });
    vi.mocked(dictationApi.commit).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof dictationApi.commit>>);

    renderSheet();
    await dictate('демонтаж старої плитки 12 квадратів');

    expect(screen.getByLabelText(/Зберегти в мій каталог/).hasAttribute('disabled')).toBe(true);

    // Type a price → the tick unlocks.
    fireEvent.change(screen.getByPlaceholderText('₴'), { target: { value: '450' } });
    expect(screen.getByLabelText(/Зберегти в мій каталог/).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByLabelText(/Зберегти в мій каталог/));

    fireEvent.click(screen.getByText(/^Додати 1/));

    await waitFor(() => expect(dictationApi.commit).toHaveBeenCalled());
    // Called ONLY after the estimate lines land — a failing catalog copy must never look like the
    // dictation failed. And with the trade left to «Інше», see open-questions.md.
    await waitFor(() => expect(createCatalogItemMock).toHaveBeenCalledTimes(1));
    expect(createCatalogItemMock.mock.calls[0][0]).toMatchObject({
      name: 'демонтаж старої плитки',
      unit: 'M2',
      defaultPrice: 450,
      trade: 'OTHER',
    });
    // A miss is not synonym material — a synonym needs a row to point AT.
    expect(dictationApi.saveSynonym).not.toHaveBeenCalled();
  });

  it('teaches a synonym only on a MATCHED-but-different row, and after the lines have landed', async () => {
    // The whole point of (e): «шпалери» → the matcher's Dice pass refuses it as a tie; a taught
    // synonym answers next time. An identical-wording match has nothing to learn.
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [
        item({ spokenName: 'шпалери', catalogItemId: 'c-wallpaper' }),   // wording differs → offered
        item({ name: 'Монтаж плінтуса', spokenName: 'монтаж плінтуса',    // same wording → not offered
          unit: 'M', quantity: 18, unitPrice: 90, catalogItemId: 'c-baseboard', category: null }),
      ],
    });
    vi.mocked(dictationApi.commit).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof dictationApi.commit>>);
    vi.mocked(dictationApi.saveSynonym).mockResolvedValue(undefined);

    renderSheet();
    await dictate('шпалери 20 квадратів; монтаж плінтуса 18 метрів');

    const ticks = screen.queryAllByLabelText(/розпізнавати «/);
    expect(ticks).toHaveLength(1); // only the differing row offers the tick

    fireEvent.click(ticks[0]);
    fireEvent.click(screen.getByText(/^Додати 2/));

    await waitFor(() => expect(dictationApi.commit).toHaveBeenCalled());
    await waitFor(() => expect(dictationApi.saveSynonym).toHaveBeenCalledTimes(1));
    expect(dictationApi.saveSynonym).toHaveBeenCalledWith('c-wallpaper', 'шпалери');
  });

  it('a failing synonym save never rolls back the commit — the estimate is what he asked for', async () => {
    vi.mocked(dictationApi.parse).mockResolvedValue({
      items: [item({ spokenName: 'шпалери', catalogItemId: 'c-wallpaper' })],
    });
    vi.mocked(dictationApi.commit).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof dictationApi.commit>>);
    vi.mocked(dictationApi.saveSynonym).mockRejectedValue(new Error('boom'));

    renderSheet();
    await dictate('шпалери 20');

    fireEvent.click(screen.getByLabelText(/розпізнавати «/));
    fireEvent.click(screen.getByText(/^Додати 1/));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(dictationApi.commit).toHaveBeenCalledTimes(1); // NOT retried, NOT rolled back
    expect(vi.mocked(toast.error).mock.calls.some((c) =>
      String(c[0]).includes('звучання'))).toBe(true);
  });
});
