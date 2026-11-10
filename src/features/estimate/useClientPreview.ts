import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { reserveLinkTab } from '@/lib/openLinkTab.ts';
import { useSenderGate } from '@/features/sender/senderGate.ts';

/**
 * «Подивитися, як побачить клієнт» — the client's page in a new tab, BEFORE anything leaves. The
 * server hands out a ten-minute preview pass (`fetchUrl`): no link is minted and no status moves, so
 * looking never counts as sharing. One estimate (`?v=`) or the object's portal with the ticked set
 * (`?vp=`) — the caller says which by what it fetches.
 *
 * <p>The name comes first, as before a PDF: the page promises «так побачить клієнт», and without a
 * name nothing goes to a client at all. The sheet spends the tap the tab was reserved in, so the
 * master is told to tap again. `ready` runs next (the outbox flush — the server renders the page from
 * what it holds); `false` from it closes the reserved tab.</p>
 */
export function useClientPreview(fetchUrl: () => Promise<string>, ready: () => Promise<boolean>) {
  const { t } = useTranslation();
  const ensureSender = useSenderGate();
  const [opening, setOpening] = useState(false);

  const open = async () => {
    if (opening) return;
    // Before ANY await: on iOS the tap is spent by the first one.
    let tab = reserveLinkTab();
    setOpening(true);
    try {
      // A name sheet spends this tap; its own «Зберегти і продовжити» is a tap too, and the tab is
      // reserved again in it, so the preview opens without a second press.
      let carriedOn = false;
      const sender = await ensureSender(() => tab.cancel(), {
        remind: false,
        onContinueTap: () => {
          tab = reserveLinkTab();
          carriedOn = true;
          return () => tab.cancel();
        },
      });
      if (sender === 'cancelled' || (sender !== 'ready' && !carriedOn)) {
        tab.cancel();
        if (sender !== 'cancelled') toast.info(t('sender.tapAgainPreview'));
        return;
      }
      if (!(await ready())) {
        tab.cancel();
        return;
      }
      tab.go(await fetchUrl());
    } catch (err) {
      tab.cancel();
      toast.error(toAppError(err).message);
    } finally {
      setOpening(false);
    }
  };

  return { open, opening };
}
