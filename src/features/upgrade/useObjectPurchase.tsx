import { useState } from 'react';
import { upgradeApi } from '@/api/upgrade.ts';
import { UpgradeIntentModal } from './UpgradeIntentModal.tsx';

/**
 * «Новий обʼєкт» at the FREE object cap stays tappable and opens the purchase sheet as the choice,
 * starting on the one-object tab (V214) — the master who wants one more object sees how to get it, not a grey button.
 * Render `purchaseModal` once in the page.
 */
export function useObjectPurchase() {
  const [open, setOpen] = useState(false);
  const openPurchase = () => {
    void upgradeApi.click('OBJECT_LIMIT'); // fire-and-forget, as the banner does
    setOpen(true);
  };
  const purchaseModal = (
    <UpgradeIntentModal open={open} onClose={() => setOpen(false)} mode="choice" />
  );
  return { openPurchase, purchaseModal };
}
