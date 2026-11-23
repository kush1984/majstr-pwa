import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { newUuid } from '@/lib/uuid.ts';
import { CatalogPicker } from '@/features/catalog/CatalogPicker.tsx';
import { AddPositionTabs, type AddPositionTab } from '@/features/catalog/AddPositionTabs.tsx';
import {
  SaveToCatalogPrompt,
  type CatalogSaveDraft,
} from '@/features/catalog/SaveToCatalogPrompt.tsx';
import { ItemForm } from './ItemForm.tsx';
import { useAddItem, useAddItemsFromCatalogBatch } from './useEstimate.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

export function AddItemSheet({
  estimateId,
  siblings = [],
  objectId,
  nextSortOrder,
  open,
  onClose,
  onAdded,
}: {
  estimateId: string;
  /** The estimate's existing lines — the base picker for a new «%» line, and the source of the
   *  «% від кошторису» base (computed inside ItemForm to match the server). */
  siblings?: EstimateItemResponse[];
  /** The object (project) id — enables "Вибрати з замірів" in the manual tab. */
  objectId?: string;
  nextSortOrder: number;
  open: boolean;
  onClose: () => void;
  /** Ids of the lines just added, so the editor can highlight them for the session. */
  onAdded?: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AddPositionTab>('catalog');
  const [catalogPrompt, setCatalogPrompt] = useState<CatalogSaveDraft | null>(null);
  const addItem = useAddItem(estimateId);
  const batch = useAddItemsFromCatalogBatch(estimateId);

  const close = () => {
    setTab('catalog');
    setCatalogPrompt(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={catalogPrompt ? t('estimate.saveToCatalogTitle') : t('estimate.addItemTitle')}
    >
      {catalogPrompt ? (
        <SaveToCatalogPrompt item={catalogPrompt} onClose={close} />
      ) : (
        <>
          <AddPositionTabs tab={tab} onChange={setTab} />

          {tab === 'catalog' ? (
            <CatalogPicker
              hint={t('estimate.batchQtyHint')}
              onPick={async (picks) => {
                // Mint the line ids here (rather than letting the batch hook do it) so the editor
                // can be told which lines were just added and highlight them for the session.
                const items = picks.map((item, i) => ({
                  id: newUuid(),
                  catalogItemId: item.id,
                  quantity: 1,
                  sortOrder: nextSortOrder + i,
                }));
                await batch.mutateAsync(items);
                onAdded?.(items.map((x) => x.id));
                close();
              }}
            />
          ) : (
            <ItemForm
              objectId={objectId}
              siblings={siblings}
              showSaveToCatalog
              enableAutocomplete
              submitLabel={t('common.add')}
              submitting={addItem.isPending}
              onSubmit={async (req, offerCatalog) => {
                try {
                  const created = await addItem.mutateAsync({ ...req, sortOrder: nextSortOrder });
                  onAdded?.([created.id]);
                  toast.success(t('estimate.itemAdded'));
                  // Offer to save a genuinely new manual item to the catalog (not
                  // one picked from the autocomplete — that's already there). The
                  // line's category/price prefill the prompt.
                  if (offerCatalog) {
                    setCatalogPrompt({
                      name: req.name,
                      type: req.type,
                      unit: req.unit,
                      category: req.category,
                      unitPrice: req.unitPrice,
                    });
                  } else {
                    close();
                  }
                } catch (err) {
                  toast.error(toAppError(err).message);
                }
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}
