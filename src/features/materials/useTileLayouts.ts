import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { materialsApi } from '@/api/materials.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { TileLayoutRequest, TileLayoutView } from '@/api/types.ts';

export const TILE_LAYOUTS_KEY = (estimateId: string) => ['tileLayouts', estimateId] as const;
export const TILE_LAYOUT_ENTITY = 'tileLayout';

/** What the outbox carries for one line's layout: a PUT, or a DELETE when `req` is null. */
export interface TileLayoutOpPayload {
  estimateId: string;
  req: TileLayoutRequest | null;
}

/** The estimate's stored layouts — the screen reopens from them, and the line menu shows «змінити». */
export function useTileLayouts(estimateId: string) {
  return useQuery({
    queryKey: TILE_LAYOUTS_KEY(estimateId),
    queryFn: () => materialsApi.tileLayouts(estimateId),
    enabled: Boolean(estimateId),
  });
}

/**
 * Save or forget one line's layout — offline-first. The op states the line's WHOLE layout, so a newer
 * one replaces a queued one (`coalesce`), and a delete after a queued save simply wins. Offline the
 * cache is patched with what the server would answer, so the line reads «розкладено» at once.
 */
export function useTileLayoutActions(estimateId: string) {
  const qc = useQueryClient();
  const key = TILE_LAYOUTS_KEY(estimateId);
  const cancel = () => qc.cancelQueries({ queryKey: key });
  const patch = (itemId: string, next: TileLayoutView | null) => {
    qc.setQueryData<TileLayoutView[]>(key, (prev = []) => {
      const rest = prev.filter((v) => v.estimateItemId !== itemId);
      return next ? [...rest, next] : rest;
    });
  };
  const settle = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['materials', estimateId] });
  };

  const save = useMutation({
    networkMode: 'always',
    mutationFn: ({ itemId, req }: { itemId: string; req: TileLayoutRequest }): Promise<TileLayoutView> =>
      offlineMutate<TileLayoutView>({
        entity: 'tileLayout', entityId: itemId, type: 'update', coalesce: true,
        payload: { estimateId, req } satisfies TileLayoutOpPayload,
        deps: [itemId],
        online: () => materialsApi.saveTileLayout(estimateId, itemId, req),
        cancel,
        optimistic: () => {
          const view: TileLayoutView = {
            estimateItemId: itemId,
            tileShortMm: Math.min(req.tileWidthMm, req.tileHeightMm),
            tileLongMm: Math.max(req.tileWidthMm, req.tileHeightMm),
            laidArea: req.laidArea,
            minTiles: req.minTiles,
            maxTiles: req.maxTiles,
            spare: req.spare,
            tilesToBuy: req.maxTiles + req.spare,
            paused: false,
            measurementsDeclined: req.measurementsDeclined ?? false,
            params: req.params,
          };
          patch(itemId, view);
          return view;
        },
      }),
    onSuccess: (view) => {
      patch(view.estimateItemId, view);
      settle();
    },
  });

  const remove = useMutation({
    networkMode: 'always',
    mutationFn: (itemId: string): Promise<void> =>
      offlineMutate<void>({
        entity: 'tileLayout', entityId: itemId, type: 'delete', coalesce: true,
        payload: { estimateId, req: null } satisfies TileLayoutOpPayload,
        deps: [itemId],
        online: () => materialsApi.deleteTileLayout(estimateId, itemId),
        cancel,
        optimistic: () => patch(itemId, null),
      }),
    onSuccess: (_v, itemId) => {
      patch(itemId, null);
      settle();
    },
  });

  return { save, remove };
}
