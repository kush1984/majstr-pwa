import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TileLayoutPage } from './TileLayoutPage.tsx';
import { ESTIMATE_KEY } from '@/features/estimate/useEstimate.ts';
import { TILE_LAYOUTS_KEY } from './useTileLayouts.ts';
import { anEstimate } from '@/test/factories.ts';
import type { EstimateItemResponse, TileLayoutRequest } from '@/api/types.ts';

const tileLayouts = vi.hoisted(() => vi.fn());
const saveTileLayout = vi.hoisted(() => vi.fn());
const deleteTileLayout = vi.hoisted(() => vi.fn());
vi.mock('@/api/materials.ts', () => ({ materialsApi: { tileLayouts, saveTileLayout, deleteTileLayout } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const addRoom = vi.hoisted(() => vi.fn());
const addItem = vi.hoisted(() => vi.fn());
const tree = vi.hoisted(() => vi.fn());
vi.mock('@/api/measurements.ts', () => ({ measurementsApi: { addRoom, addItem, tree } }));

const line = (over: Partial<EstimateItemResponse> = {}): EstimateItemResponse => ({
  id: 'i1', type: 'WORK', name: 'Укладання плитки 300х600', category: null, trade: 'TILING', unit: 'M2',
  quantity: 20, unitPrice: 500, lineTotal: 10000, sortOrder: 0, measurementRefs: [], quantityManual: false,
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
  ...over,
} as EstimateItemResponse);

function renderPage(item = line()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData([...ESTIMATE_KEY, 'est-1'], anEstimate({ id: 'est-1', items: [item] }));
  qc.setQueryData(TILE_LAYOUTS_KEY('est-1'), []);
  const router = createMemoryRouter(
    [
      { path: '/estimates/:id/items/:itemId/tile-layout', element: <TileLayoutPage /> },
      { path: '*', element: <div>інший екран</div> },
    ],
    { initialEntries: ['/estimates/est-1/items/i1/tile-layout'] },
  );
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const echo = (_e: string, itemId: string, req: TileLayoutRequest) => Promise.resolve({
  estimateItemId: itemId, tileShortMm: 300, tileLongMm: 600, laidArea: req.laidArea, minTiles: req.minTiles,
  maxTiles: req.maxTiles, spare: req.spare, tilesToBuy: req.maxTiles + req.spare, paused: false,
  measurementsDeclined: req.measurementsDeclined ?? false, params: req.params,
});

beforeEach(() => {
  tileLayouts.mockReset();
  saveTileLayout.mockReset().mockImplementation(echo);
  deleteTileLayout.mockReset();
  addRoom.mockReset().mockImplementation((_o: string, req: { name: string }, id: string) => Promise.resolve({
    rooms: [{ id, name: req.name, floor: null, sortOrder: 0, items: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 }],
    areaTotal: 0, linearTotal: 0, pieceTotal: 0,
  }));
  addItem.mockReset().mockResolvedValue({ rooms: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 });
  tree.mockReset().mockResolvedValue({ rooms: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 });
});

async function layOutOneWall() {
  renderPage();
  fireEvent.click(screen.getByText('Окремі поверхні'));
  type(/^Ширина, м/, '1,85');
  type(/^Висота, м/, '2,55');
  fireEvent.click(screen.getByRole('button', { name: /Готово/ }));
  await screen.findByText('Зберегти розміри в заміри обʼєкта?');
}

describe('TileLayoutPage', () => {
  it('reads the format off the line and asks how the surface looks', () => {
    renderPage();
    expect(screen.getByLabelText<HTMLSelectElement>(/Формат/).value).toBe('300x600');
    screen.getByText('Як виглядає те, що облицьовуєте?');
  });

  it('a room builds the walls; «Готово» saves the range the engine counted, never touching the line', async () => {
    saveTileLayout.mockImplementation((_e: string, itemId: string, req: TileLayoutRequest) => Promise.resolve({
      estimateItemId: itemId, tileShortMm: 300, tileLongMm: 600, laidArea: req.laidArea, minTiles: req.minTiles,
      maxTiles: req.maxTiles, spare: req.spare, tilesToBuy: req.maxTiles + req.spare, paused: false,
      measurementsDeclined: false, params: req.params,
    }));
    renderPage();
    fireEvent.click(screen.getByText('Кімната'));
    type(/Довжина, м/, '2,05');
    type(/Ширина, м/, '1,85');
    type(/Висота облицювання, м/, '2,55');
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    // Four walls and the floor; the 20 m² line is not the 3,8 m² floor, so the walls are ticked.
    expect(screen.getAllByLabelText(/Назва поверхні/)).toHaveLength(5);
    // Four walls as measured: 2 × (2,05 + 1,85) × 2,55 = 19,89 m².
    screen.getByText(/Розкладено 19,89 з 20 м²/);
    expect(screen.queryByText(/Поверхонь більше, ніж у позиції/)).toBeNull();

    const done = screen.getByRole('button', { name: /Готово/ });
    fireEvent.click(done);
    await waitFor(() => expect(saveTileLayout).toHaveBeenCalledTimes(1));
    const [estimateId, itemId, req] = saveTileLayout.mock.calls[0] as [string, string, TileLayoutRequest];
    expect([estimateId, itemId]).toEqual(['est-1', 'i1']);
    expect(req.tileWidthMm).toBe(300);
    expect(req.tileHeightMm).toBe(600);
    expect(req.minTiles).toBeLessThanOrEqual(req.maxTiles);
    expect(req.spare).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(req.params)).toMatchObject({ version: 1, format: { short: 300, long: 600 } });
    // The sizes were typed here, so the measurements are offered (stage 4) before going back.
    fireEvent.click(await screen.findByRole('button', { name: 'Ні' }));
    await screen.findByText('інший екран');
  });

  it('a narrow strip is named with its width and fixed with one tap', () => {
    renderPage();
    fireEvent.click(screen.getByText('Окремі поверхні'));
    type(/^Ширина, м/, '1850');
    type(/^Висота, м/, '2550');
    fireEvent.change(screen.getByLabelText('Старт'), { target: { value: 'CORNER' } });
    screen.getByText(/Справа смужка 40 мм/);
    fireEvent.click(screen.getByRole('button', { name: 'Почати симетрично' }));
    expect(screen.queryByText(/смужка 40 мм/)).toBeNull();
  });

  it('sizes are typed in metres; a number too big for metres is read as mm, and says so', () => {
    renderPage();
    fireEvent.click(screen.getByText('Окремі поверхні'));
    type(/^Ширина, м/, '1850');
    type(/^Висота, м/, '2,55');
    screen.getByText('Прочитали як мм: 1,85 м');
    // The same wall as 1,85 × 2,55 m: 1,85 × 2,55 = 4,72 m².
    screen.getByText(/Розкладено 4,72 з 20 м²/);
    expect(screen.queryByText(/Розміри поверхні/)).toBeNull();
  });

  it('no red error before the sizes are typed', () => {
    renderPage();
    fireEvent.click(screen.getByText('Окремі поверхні'));
    expect(screen.queryByText(/Розміри поверхні/)).toBeNull();
  });

  it('a line «на підлогу» is laid out as a floor, not «Стіна 1»', () => {
    renderPage(line({ name: 'Укладання плитки на підлогу 60×60' }));
    expect(screen.queryByText('Окремі поверхні')).toBeNull();
    fireEvent.click(screen.getByText('Підлога'));
    expect(screen.getByLabelText<HTMLInputElement>(/Назва поверхні/).value).toBe('Підлога');
    type(/^Довжина, м/, '5');
    type(/^Ширина, м/, '4');
    screen.getByText(/Розкладено 20 з 20 м²/);
  });

  it('the object measured surfaces are offered with one tap, even when the line names none', async () => {
    tree.mockResolvedValue({
      rooms: [{ id: 'r1', name: 'Кухня', floor: null, sortOrder: 0, areaTotal: 0, linearTotal: 0, pieceTotal: 0, items: [{
        id: 'm1', type: 'SURFACE', name: 'Підлога', payload: { unit: 'M', segments: [{ shape: 'rect', values: { a: 4.2, b: 3.1 } }], openings: [] },
      }] }],
      areaTotal: 0, linearTotal: 0, pieceTotal: 0,
    });
    renderPage(line({ name: 'Укладання плитки на підлогу 60×60' }));
    fireEvent.click(await screen.findByText('Кухня · Підлога'));
    expect(screen.getByLabelText<HTMLInputElement>(/^Довжина, м/).value).toBe('4,2');
    expect(screen.getByLabelText<HTMLInputElement>(/^Ширина, м/).value).toBe('3,1');
  });

  it('a line with no format asks for one first', () => {
    renderPage(line({ name: 'Облицювання фартуха' }));
    screen.getByText('У назві позиції немає формату — виберіть плитку.');
    expect(screen.queryByText('Як виглядає те, що облицьовуєте?')).toBeNull();
  });

  it('a line that is not tiling work is refused', () => {
    renderPage(line({ unit: 'LINEAR_METER' }));
    screen.getByText('Тут розкладки немає');
  });

  it('typed sizes: «Зберегти в заміри» makes a room with the walls, and the line is never asked again', async () => {
    await layOutOneWall();
    fireEvent.change(screen.getByLabelText('Приміщення'), { target: { value: 'Ванна' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти в заміри' }));
    await screen.findByText('інший екран');
    expect(addRoom).toHaveBeenCalledWith('p1', { name: 'Ванна' }, expect.any(String));
    const [, roomId, item] = addItem.mock.calls[0] as [string, string, { name: string; payload: { unit: string } }];
    expect(roomId).toBe(addRoom.mock.calls[0][2]);
    expect(item).toMatchObject({ name: 'Стіни', type: 'SURFACE', payload: { unit: 'MM' } });
    const last = saveTileLayout.mock.calls.at(-1)?.[2] as TileLayoutRequest;
    expect(JSON.parse(last.params)).toMatchObject({ savedToMeasurements: true });
  });

  it('«Ні» is remembered on the line and writes no measurement', async () => {
    await layOutOneWall();
    fireEvent.click(screen.getByRole('button', { name: 'Ні' }));
    await screen.findByText('інший екран');
    expect(addRoom).not.toHaveBeenCalled();
    expect((saveTileLayout.mock.calls.at(-1)?.[2] as TileLayoutRequest).measurementsDeclined).toBe(true);
  });

  it('«Посунути вручну» hands the grid over from where it stands; a nudge moves it 5 mm', () => {
    renderPage();
    fireEvent.click(screen.getByText('Окремі поверхні'));
    type(/^Ширина, м/, '1850');
    type(/^Висота, м/, '2550');
    fireEvent.change(screen.getByLabelText('Старт'), { target: { value: 'CORNER' } });
    screen.getByText(/Справа смужка 40 мм/);
    fireEvent.click(screen.getByRole('button', { name: /Посунути розкладку вручну/ }));
    // Taken over as it stood: still the corner layout, now under the master's hand.
    expect(screen.getByLabelText<HTMLSelectElement>('Старт').value).toBe('MANUAL');
    screen.getByText(/Справа смужка 40 мм/);
    // The grid 5 mm to the left: the right strip grows from 40 to 45 mm.
    fireEvent.click(screen.getByRole('button', { name: 'Ліворуч на 5 мм' }));
    screen.getByText(/Справа смужка 45 мм/);
    fireEvent.click(screen.getByRole('button', { name: 'Зафіксувати' }));
    expect(screen.queryByRole('button', { name: 'Ліворуч на 5 мм' })).toBeNull();
  });
});
