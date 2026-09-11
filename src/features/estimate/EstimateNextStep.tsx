import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { formatDate } from '@/lib/format.ts';
import type { EstimateStatus } from '@/api/types.ts';

/**
 * «Що далі?» — the block that closes the estimate editor, sitting after the last position and
 * INSIDE the scroll.
 *
 * <p>It exists because of a measured failure: 90 masters created an estimate and 13 shared it. The
 * sharing action was never missing — it was the seventh row of a speed-dial behind a «＋» button
 * that reads as «add», and a master who wrote to us said in as many words that he «не розібрався,
 * що є фаб батон який має меню всередині». A finished estimate has exactly one obvious next move,
 * so the screen should say it in words at the point where the master runs out of positions.</p>
 *
 * <p><b>Not sticky and not fixed, deliberately.</b> Pinned to the viewport it would fight the
 * summary sheet and the FAB for the same thumb zone — three floating things at the bottom of one
 * screen. In the scroll it is simply the end of the document, which is where «what now» belongs.</p>
 *
 * <p><b>Exactly one primary action per state</b>, full width and ≥48 px; everything else is a quiet
 * text row. The moment a second loud button appears the block stops answering the question it asks
 * in its own heading.</p>
 *
 * <p>REJECTED renders as DRAFT on purpose: nothing in the product can currently produce that status
 * (the only write is a hand-made PUT), and a rejected estimate is editable and re-sendable anyway.
 * One branch, no dead screen — see the open-questions entry.</p>
 */
export function EstimateNextStep({
  status,
  signedAt,
  onShare,
  onCreateAct,
  onMaterials,
  showMaterials,
  onPdf,
}: {
  status: EstimateStatus;
  /** When the client signed it; absent on anything but a SIGNED estimate. */
  signedAt?: string | null;
  onShare: () => void;
  onCreateAct: () => void;
  onMaterials: () => void;
  /** False only when the server says nothing can be calculated for this estimate's trades (V129). */
  showMaterials: boolean;
  onPdf: () => void;
}) {
  const { t } = useTranslation();

  const signed = status === 'SIGNED';
  const sent = status === 'SENT';

  const title = signed
    ? (signedAt != null
      ? t('estimate.nextStep.signedTitle', { date: formatDate(signedAt) })
      : t('estimate.nextStep.signedTitleNoDate'))
    : sent
      ? t('estimate.nextStep.sentTitle')
      : t('estimate.nextStep.draftTitle');
  const hint = signed
    ? t('estimate.nextStep.signedHint')
    : sent
      ? t('estimate.nextStep.sentHint')
      : t('estimate.nextStep.draftHint');
  const primary = signed
    ? { label: t('estimate.nextStep.createAct'), onClick: onCreateAct }
    : sent
      // The reminder this used to carry was dropped by the master: there is no reminder flow, and
      // re-sending the same letter is not one. What he actually needs at this point is the link
      // itself — Ukrainian masters nudge a client in Viber or Telegram, not by email.
      ? { label: t('estimate.nextStep.showLink'), onClick: onShare }
      : { label: t('estimate.nextStep.send'), onClick: onShare };

  return (
    <section
      data-testid="estimate-next-step"
      className="mt-4 rounded-card border border-border bg-surface p-4"
    >
      <h2 className="text-[15px] font-bold leading-snug text-primary">{title}</h2>
      <p className="mt-1 text-xs leading-snug text-muted">{hint}</p>
      <Button fullWidth className="mt-3.5 min-h-[48px] text-[15px] font-semibold" onClick={primary.onClick}>
        {primary.label}
      </Button>
      {/* Quiet on purpose: these are alternatives, not competitors. Full-width rows so the tap
          target is the whole line rather than the words. */}
      <div className="mt-1.5 flex flex-col">
        {/* Absent, not disabled: on a trade V127 has no norms for there is nothing to explain. */}
        {showMaterials && (
          <SecondaryAction icon="🧮" label={t('estimate.nextStep.materials')} onClick={onMaterials} />
        )}
        <SecondaryAction icon="📄" label={t('estimate.nextStep.pdf')} onClick={onPdf} />
      </div>
    </section>
  );
}

function SecondaryAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-1 text-left text-sm font-semibold text-brand active:bg-surface-sunken"
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </button>
  );
}
