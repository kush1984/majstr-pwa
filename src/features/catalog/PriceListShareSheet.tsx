import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { priceListApi } from '@/api/priceList.ts';
import type { PriceListResponse } from '@/api/types.ts';
import { copyWhenReady } from '@/lib/asyncClipboard.ts';
import { canShareNatively, shareNatively } from '@/lib/shareLink.ts';
import { sharePdf } from '@/lib/sharePdf.ts';
import { useClientPreview } from '@/features/estimate/useClientPreview.ts';

/**
 * «Поділитися прайсом» — the ways out, once the master has ticked his works (V205). Every way saves the
 * ticks first, so what leaves is exactly what is ticked on screen.
 */
export function PriceListShareSheet({
  open,
  onClose,
  itemIds,
  liveUrl,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  itemIds: string[];
  /** The link already live before this share, if any — offers «Закрити посилання». */
  liveUrl: string | null;
  onSaved: (state: PriceListResponse) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'share' | 'copy' | 'pdf' | 'revoke' | null>(null);
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const nativeShare = canShareNatively();
  const nothing = itemIds.length === 0;
  // One way out at a time: two saves at once would race for the one live link.
  const locked = busy !== null;

  const save = async (): Promise<string> => {
    const state = await priceListApi.save({ itemIds });
    onSaved(state);
    if (!state.url) throw new Error('price list saved without a link');
    return state.url;
  };
  const fail = (err: unknown) => toast.error(toAppError(err).message);

  // Looking is not sharing: the preview saves the ticks on a ten-minute pass and mints no link, as an
  // estimate's preview does.
  const preview = useClientPreview(
    () => priceListApi.preview({ itemIds }).then((r) => r.url),
    () => Promise.resolve(true),
  );

  const onShare = async () => {
    setBusy('share');
    try {
      const url = await save();
      const outcome = await shareNatively(url, t('priceList.shareText'));
      if (outcome === 'shared') {
        onClose();
      } else if (outcome === 'blocked') {
        setShownUrl(url);
        toast.info(t('portal.shareTapAgain'));
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    setBusy('copy');
    try {
      const { copied, value } = await copyWhenReady(save);
      if (copied) {
        toast.success(t('estimate.linkCopied'));
        onClose();
      } else {
        setShownUrl(value);
        toast.error(t('estimate.linkCopyFailed'));
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onPdf = async () => {
    setBusy('pdf');
    try {
      await save();
      const blob = await priceListApi.fetchPdfBlob();
      await sharePdf(blob, `${t('priceList.fileName')}.pdf`, t('priceList.title'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onRevoke = async () => {
    setBusy('revoke');
    try {
      onSaved(await priceListApi.revoke());
      setShownUrl(null);
      toast.success(t('portal.linkClosed'));
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('priceList.title')}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('priceList.sheetHint', { count: itemIds.length })}</p>

        {shownUrl && <Input readOnly value={shownUrl} onFocus={(e) => e.currentTarget.select()} />}

        {nativeShare && (
          <Button fullWidth disabled={nothing || locked} loading={busy === 'share'} onClick={() => void onShare()}>
            {t('estimate.shareNative')}
          </Button>
        )}
        <Button variant={nativeShare ? 'secondary' : 'primary'} fullWidth disabled={nothing || locked}
          loading={busy === 'copy'} onClick={() => void onCopy()}>
          {t('estimate.copyLink')}
        </Button>
        <Button variant="secondary" fullWidth disabled={nothing || locked} loading={busy === 'pdf'}
          onClick={() => void onPdf()}>
          {t('priceList.pdf')}
        </Button>
        <button type="button" onClick={() => void preview.open()}
          disabled={nothing || locked || preview.opening} aria-busy={preview.opening}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-brand active:bg-surface-sunken disabled:opacity-60">
          <span aria-hidden>👁</span>
          {t('estimate.nextStep.preview')}
        </button>
        {liveUrl && (
          <Button variant="secondary" fullWidth disabled={locked} loading={busy === 'revoke'} onClick={() => void onRevoke()}>
            {t('portal.closeLink')}
          </Button>
        )}
        <p className="text-xs text-muted">{t('priceList.liveHint')}</p>
      </div>
    </Modal>
  );
}
