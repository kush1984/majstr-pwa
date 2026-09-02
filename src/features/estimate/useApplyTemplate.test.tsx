import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import { TemplateNotCachedError, useApplyTemplate } from './useEstimateTemplates.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type {
  CatalogItemResponse, EstimateResponse, EstimateTemplateDetail,
} from '@/api/types.ts';

/**
 * Applying a template with no signal. The server does this in one request (it substitutes prices
 * from the master's catalog), which is why the action used to be refused offline with
 * "потрібен інтернет" — even though every input is already cached. These pin the local
 * composition: the same name-matching rule as the backend, and a queue the replay can trust.
 */
const TEMPLATE_KEY = ['estimate-templates', 'tpl-1'] as const;
const CATALOG_KEY = ['catalog', 'list', 'all'] as const;
const PROJECT_ID = 'proj-1';

const template: EstimateTemplateDetail = {
  id: 'tpl-1',
  name: 'Ванна під ключ',
  trade: 'TILING',
  customTradeId: null,
  customTradeName: null,
  isDefault: false,
  items: [
    { id: 'ti-1', name: 'Штукатурка стін', type: 'WORK', unit: 'M2', sortOrder: 0 },
    { id: 'ti-2', name: 'Плитка', type: 'MATERIAL', unit: 'M2', sortOrder: 1 },
    { id: 'ti-3', name: 'Немає в каталозі', type: 'WORK', unit: 'PIECE', sortOrder: 2 },
  ],
};

/** Note the case difference and the duplicate — both matter for the matching rule. */
const catalog: CatalogItemResponse[] = [
  {
    id: 'c-1', name: 'штукатурка стін', category: 'Стіни', trade: 'TILING', customTradeId: null, customTradeName: null,
    type: 'WORK', unit: 'M2', defaultPrice: 250, sortOrder: 0, createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'c-2', name: 'Плитка', category: null, trade: 'TILING', customTradeId: null, customTradeName: null,
    type: 'MATERIAL', unit: 'M2', defaultPrice: 900, sortOrder: 0, createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'c-3', name: 'ПЛИТКА', category: 'дубль', trade: null, customTradeId: null, customTradeName: null,
    type: 'MATERIAL', unit: 'PIECE', defaultPrice: 1, sortOrder: 0, createdAt: '2026-01-02T00:00:00Z',
  },
];

function harness(seed: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(qc);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, ...renderHook(() => useApplyTemplate(), { wrapper }) };
}

describe('useApplyTemplate offline', () => {
  beforeEach(async () => {
    await clearOutbox();
    onlineManager.setOnline(false);
  });

  it('composes the estimate locally and queues it with its lines', async () => {
    const { qc, result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: { name: 'Ванна' },
    });

    // --- the composed estimate ------------------------------------------------
    expect(estimate.items).toHaveLength(3);
    const [plaster, tile, unmatched] = estimate.items;

    // Matched case-insensitively → price, category and unit come from the CATALOG.
    expect(plaster.name).toBe('Штукатурка стін');
    expect(plaster.unitPrice).toBe(250);
    expect(plaster.category).toBe('Стіни');
    // Duplicate catalog names: the first entry wins, exactly as the server's merge does.
    expect(tile.unitPrice).toBe(900);
    expect(tile.unit).toBe('M2');
    // No catalog match → keep the template's own type/unit at price 0.
    expect(unmatched.unitPrice).toBe(0);
    expect(unmatched.unit).toBe('PIECE');
    expect(unmatched.type).toBe('WORK');
    // Quantities always start empty — the master fills them on site.
    expect(estimate.items.every((i) => i.quantity === 0)).toBe(true);
    expect(estimate.total).toBe(0);
    expect(estimate.status).toBe('DRAFT');

    // --- the queue ------------------------------------------------------------
    const ops = await listOutbox();
    expect(ops.map((o) => o.entity)).toEqual([
      'estimate', 'estimateItem', 'estimateItem', 'estimateItem',
    ]);
    const [head, ...lines] = ops;
    expect(head.deps).toEqual([PROJECT_ID]); // waits for the object
    expect(head.entityId).toBe(estimate.id);
    // Every line depends on the estimate, so replay can never orphan one.
    expect(lines.every((l) => l.deps.includes(estimate.id))).toBe(true);
    // Order is preserved through sortOrder, not by luck of the queue.
    expect(lines.map((l) => (l.payload as { req: { sortOrder: number } }).req.sortOrder))
      .toEqual([0, 1, 2]);

    // --- the cache, so the estimate opens filled in ---------------------------
    expect(qc.getQueryData<EstimateResponse>(['estimate', estimate.id])?.items).toHaveLength(3);
    expect(qc.getQueryData<{ id: string }[]>(['project-estimates', PROJECT_ID]))
      .toEqual([expect.objectContaining({ id: estimate.id })]);
  });

  it('still applies when the catalog was never cached (prices left at 0)', async () => {
    const { result } = harness((c) => c.setQueryData(TEMPLATE_KEY, template));

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    });

    expect(estimate.items).toHaveLength(3);
    expect(estimate.items.every((i) => i.unitPrice === 0)).toBe(true);
    expect(await listOutbox()).toHaveLength(4);
  });

  it('refuses when the template composition was never cached', async () => {
    // Creating an EMPTY estimate here would look like the template had no positions —
    // a lie about the master's own data. Fail so the UI can explain.
    const { result } = harness((c) => c.setQueryData(CATALOG_KEY, catalog));

    await expect(result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    })).rejects.toBeInstanceOf(TemplateNotCachedError);

    expect(await listOutbox()).toHaveLength(0); // nothing half-queued
  });

  it('online: lets the server compose and queues nothing', async () => {
    onlineManager.setOnline(true);
    const served = { id: 'from-server', items: [] } as unknown as EstimateResponse;
    const spy = vi.spyOn(estimateTemplatesApi, 'applyToProject').mockResolvedValue(served);
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    });

    // The server's substitution stays authoritative while there is a connection.
    expect(spy).toHaveBeenCalledWith(PROJECT_ID, [{ templateId: 'tpl-1' }], {});
    expect(estimate).toBe(served);
    expect(await listOutbox()).toHaveLength(0);
    spy.mockRestore();
  });

  it('merges several bundles offline and bills an overlapping position once', async () => {
    // Every tiling bundle carries the primer. Applying two of them must not bill it twice — the
    // client would see the repeat on the estimate, so the offline path replays the server's rule.
    const second: EstimateTemplateDetail = {
      id: 'tpl-2', name: 'Підлога плиткою', trade: 'TILING',
      customTradeId: null, customTradeName: null, isDefault: true,
      items: [
        // Same position as tpl-1's first line, different case — matched all the same.
        { id: 'ti-4', name: 'ШТУКАТУРКА СТІН', type: 'WORK', unit: 'M2', sortOrder: 0 },
        { id: 'ti-5', name: 'Стяжка', type: 'WORK', unit: 'M2', sortOrder: 1 },
      ],
    };
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(['estimate-templates', 'tpl-2'], second);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }, { templateId: 'tpl-2' }], req: {},
    });

    expect(estimate.items.map((i) => i.name)).toEqual([
      'Штукатурка стін', 'Плитка', 'Немає в каталозі', 'Стяжка',
    ]);
    // Renumbered across the whole result — each template counts its own sortOrder from 0, so
    // carrying them over would interleave the two bundles.
    expect(estimate.items.map((i) => i.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(await listOutbox()).toHaveLength(5); // one estimate + four lines
  });

  it('takes only the ticked positions, and an empty pick still means the whole bundle', async () => {
    // Mirrors EstimateTemplateService: the subset is applied BEFORE the name de-dup, so an untick
    // in the first bundle lets the second one's wording of the same position through instead of
    // dropping the line entirely.
    const second: EstimateTemplateDetail = {
      id: 'tpl-2', name: 'Підлога плиткою', trade: 'TILING',
      customTradeId: null, customTradeName: null, isDefault: true,
      items: [
        { id: 'ti-4', name: 'ШТУКАТУРКА СТІН', type: 'WORK', unit: 'M2', sortOrder: 0 },
        { id: 'ti-5', name: 'Стяжка', type: 'WORK', unit: 'M2', sortOrder: 1 },
      ],
    };
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(['estimate-templates', 'tpl-2'], second);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID,
      // tpl-1 narrowed to its second line only; tpl-2 named no position, so it comes whole.
      picks: [{ templateId: 'tpl-1', itemIds: ['ti-2'] }, { templateId: 'tpl-2' }],
      req: {},
    });

    expect(estimate.items.map((i) => i.name)).toEqual(['Плитка', 'ШТУКАТУРКА СТІН', 'Стяжка']);
    expect(estimate.items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it('refuses when ONE of several bundles was never cached', async () => {
    // Applying the rest would produce an estimate that is short a section and looks complete.
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    await expect(result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }, { templateId: 'never-opened' }], req: {},
    })).rejects.toBeInstanceOf(TemplateNotCachedError);

    expect(await listOutbox()).toHaveLength(0);
  });

  it('online but the request drops: falls back to composing locally', async () => {
    onlineManager.setOnline(true);
    // navigator.onLine lies on one bar — the request dies, and the work must survive anyway.
    const blip = Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined });
    const spy = vi.spyOn(estimateTemplatesApi, 'applyToProject').mockRejectedValue(blip);
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    });

    expect(estimate.items).toHaveLength(3);
    expect(await listOutbox()).toHaveLength(4);
    spy.mockRestore();
  });

  it('online: a real validation error is surfaced, not queued', async () => {
    onlineManager.setOnline(true);
    const rejected = Object.assign(new Error('Bad Request'), {
      isAxiosError: true, response: { status: 400, data: {} },
    });
    const spy = vi.spyOn(estimateTemplatesApi, 'applyToProject').mockRejectedValue(rejected);
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    await expect(result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    })).rejects.toBe(rejected);

    expect(await listOutbox()).toHaveLength(0); // a 400 is not something replay can fix
    spy.mockRestore();
  });
});

/**
 * V121 — a finish level is a BUNDLE, and the paragraph it promises the client rides onto the
 * estimate at apply time as a SNAPSHOT (never a join). The offline composition therefore has to
 * take the same snapshot the server takes, or an estimate authored with no signal would read
 * differently from one authored with a bar of signal.
 */
describe('useApplyTemplate offline — the finish level the bundle promises', () => {
  beforeEach(async () => {
    await clearOutbox();
    onlineManager.setOnline(false);
  });

  const Q4 = 'Q4 — суцільне шпаклювання по всій площині. Під глянець і бокове світло.';

  const described = (id: string, name: string, description: string | null): EstimateTemplateDetail => ({
    ...template, id, name, description,
    items: [{ id: `${id}-1`, name: 'Штукатурка стін', type: 'WORK', unit: 'M2', sortOrder: 0 }],
  });

  it('copies the paragraph onto the estimate the master is about to fill in', async () => {
    const { qc, result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, described('tpl-1', 'Підготовка ГКЛ · Q4', Q4));
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    });

    expect(estimate.qualityNote).toBe(Q4);
    expect(qc.getQueryData<EstimateResponse>(['estimate', estimate.id])?.qualityNote).toBe(Q4);
  });

  it('says the same thing once when two bundles promise the same level', async () => {
    // The client reads this under the table. Applying Q4 alongside a bundle that repeats its
    // wording must not make him read the paragraph twice — the server dedups, so this does.
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, described('tpl-1', 'Q4 — стеля', Q4));
      c.setQueryData(['estimate-templates', 'tpl-2'], described('tpl-2', 'Q4 — стіни', ` ${Q4} `));
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }, { templateId: 'tpl-2' }], req: {},
    });

    expect(estimate.qualityNote).toBe(Q4);
  });

  it('joins two different levels in the order they were picked', async () => {
    const q1 = 'Q1 — стики і саморізи, далі плитка.';
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, described('tpl-1', 'Q4', Q4));
      c.setQueryData(['estimate-templates', 'tpl-2'], described('tpl-2', 'Q1', q1));
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-2' }, { templateId: 'tpl-1' }], req: {},
    });

    expect(estimate.qualityNote).toBe(`${q1}\n\n${Q4}`);
  });

  it('leaves it absent when no bundle explains itself', async () => {
    // Most bundles are a list of jobs and nothing more. An empty «Стандарт робіт» card under the
    // client's table would read as a promise the master never made.
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, described('tpl-1', 'Санвузол', '   '));
      c.setQueryData(CATALOG_KEY, catalog);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    });

    expect(estimate.qualityNote).toBeNull();
  });

  it('carries each line its own catalog explanation (V119), matched the same way as its price', async () => {
    const means = 'Машинна штукатурка, маяки, під фарбування.';
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, [{ ...catalog[0], description: means }, ...catalog.slice(1)]);
    });

    const estimate = await result.current.mutateAsync({
      projectId: PROJECT_ID, picks: [{ templateId: 'tpl-1' }], req: {},
    });

    expect(estimate.items[0].description).toBe(means);
    // No catalog match → no explanation, exactly as the price falls back to 0.
    expect(estimate.items[2].description).toBeNull();
  });
});
