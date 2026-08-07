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
      projectId: PROJECT_ID, templateIds: ['tpl-1'], req: { name: 'Ванна' },
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
      projectId: PROJECT_ID, templateIds: ['tpl-1'], req: {},
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
      projectId: PROJECT_ID, templateIds: ['tpl-1'], req: {},
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
      projectId: PROJECT_ID, templateIds: ['tpl-1'], req: {},
    });

    // The server's substitution stays authoritative while there is a connection.
    expect(spy).toHaveBeenCalledWith(PROJECT_ID, ['tpl-1'], {});
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
      projectId: PROJECT_ID, templateIds: ['tpl-1', 'tpl-2'], req: {},
    });

    expect(estimate.items.map((i) => i.name)).toEqual([
      'Штукатурка стін', 'Плитка', 'Немає в каталозі', 'Стяжка',
    ]);
    // Renumbered across the whole result — each template counts its own sortOrder from 0, so
    // carrying them over would interleave the two bundles.
    expect(estimate.items.map((i) => i.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(await listOutbox()).toHaveLength(5); // one estimate + four lines
  });

  it('refuses when ONE of several bundles was never cached', async () => {
    // Applying the rest would produce an estimate that is short a section and looks complete.
    const { result } = harness((c) => {
      c.setQueryData(TEMPLATE_KEY, template);
      c.setQueryData(CATALOG_KEY, catalog);
    });

    await expect(result.current.mutateAsync({
      projectId: PROJECT_ID, templateIds: ['tpl-1', 'never-opened'], req: {},
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
      projectId: PROJECT_ID, templateIds: ['tpl-1'], req: {},
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
      projectId: PROJECT_ID, templateIds: ['tpl-1'], req: {},
    })).rejects.toBe(rejected);

    expect(await listOutbox()).toHaveLength(0); // a 400 is not something replay can fix
    spy.mockRestore();
  });
});
