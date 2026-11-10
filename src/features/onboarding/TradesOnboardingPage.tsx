import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import { routes } from '@/lib/config.ts';
import { CUSTOM_TRADE_EMOJI, TRADE_EMOJI } from '@/lib/labels.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useAddCustomTrade, useUpdateTrades } from '@/features/profile/useProfile.ts';
import type { Trade } from '@/api/types.ts';
import { needsTradesScreen, rememberTradesAnswer, type PendingTradesAnswer } from './tradesOnboarding.ts';
import { useSampleProject } from '@/features/projects/useSampleProject.ts';

/** Where to go once he has answered — the screen that sent him here, else home. */
function returnTo(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && from !== routes.welcome ? from : routes.home;
}

/** What the sending screen asked to get back once a trade is saved — the empty template picker
 *  wants itself reopened, so choosing a trade carries the new estimate on instead of ending it. */
function resumeState(state: unknown): unknown {
  return (state as { resume?: unknown } | null)?.resume ?? null;
}

/**
 * «Чим займаєтесь?» — the first screen after registration (V190), and the one the empty template
 * picker leads back to.
 *
 * <p>The trade is what fills the catalog with priced positions and the picker with bundles, so it is
 * asked here, inside the app, where it reads as setting the app up for him rather than as a form at
 * the door. It may be skipped — with the consequence said plainly first: no trade, no templates and
 * an empty catalog, every line typed by hand.</p>
 *
 * <p>Saving goes through `PUT /api/profile/trades`, which fills the starter catalog of every newly
 * picked trade in the same request and stamps the answer (V193) — a skip goes the same way. With no connection either answer is kept on the
 * device and sent later (`useTradesAnswerSync`), so the screen never locks him out. Custom trades are created one by one through their own endpoint,
 * as on the profile screen.</p>
 */
export function TradesOnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me } = useMe();
  const updateTrades = useUpdateTrades();
  const addCustomTrade = useAddCustomTrade();
  const sample = useSampleProject();

  const [picked, setPicked] = useState<Trade[]>(() => me?.trades ?? []);
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sent here by the gate, but the server says the trades are there after all (another device, or a
  // cache restored a moment stale): nothing to ask — go back. Opened on purpose (the empty template
  // picker) it stays, so a trade can be added.
  const redirected = Boolean((location.state as { redirected?: unknown } | null)?.redirected);
  useEffect(() => {
    if (redirected && me && !needsTradesScreen(me)) void navigate(returnTo(location.state), { replace: true });
  }, [redirected, me, navigate, location.state]);

  const existingCustom = me?.customTrades ?? [];
  const nothingChosen = picked.length === 0 && customNames.length === 0 && existingCustom.length === 0;
  const done = (resume = false) =>
    void navigate(returnTo(location.state), { replace: true, state: resume ? resumeState(location.state) : null });

  /** No connection: the answer waits on the device (`useTradesAnswerSync`) and he goes on into the app. */
  const keptOffline = (err: unknown, answer: PendingTradesAnswer): boolean => {
    if (!me || toAppError(err).code !== 'NETWORK') return false;
    rememberTradesAnswer(me.id, answer);
    return true;
  };

  const toggle = (trade: Trade) =>
    setPicked((prev) => (prev.includes(trade) ? prev.filter((x) => x !== trade) : [...prev, trade]));

  const addCustomName = () => {
    const name = customDraft.trim();
    const known = [...customNames, ...existingCustom.map((c) => c.name)];
    if (name && !known.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setCustomNames((prev) => [...prev, name]);
    }
    setCustomDraft('');
    setAddingCustom(false);
  };

  /** The answer itself — «Далі» and «Подивитися приклад» both save it first. */
  const saveTrades = async () => {
    await updateTrades.mutateAsync({ trades: picked });
    for (const name of customNames) {
      try {
        await addCustomTrade.mutateAsync(name);
      } catch (err) {
        // A duplicate (an older tab added it) is fine — the trade exists either way.
        if (toAppError(err).status !== 409) throw err;
      }
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await saveTrades();
      if (picked.length > 0) toast.success(t('onboarding.trades.saved'));
      // Only a trade brings bundles; a custom-only answer has none to reopen the picker on.
      done(picked.length > 0);
    } catch (err) {
      if (keptOffline(err, { trades: picked, customNames })) {
        toast.info(t('onboarding.trades.savedOffline'));
        done();
        return;
      }
      toast.error(toAppError(err).message);
    } finally {
      setSaving(false);
    }
  };

  // The skip is an answer the SERVER keeps (V193), sent with the trades he already has — opened from
  // the template picker, a skip must not wipe them.
  const onSkip = async () => {
    setSaving(true);
    try {
      await updateTrades.mutateAsync({ trades: me?.trades ?? [] });
      setConfirmSkip(false);
      done();
    } catch (err) {
      if (keptOffline(err, { trades: me?.trades ?? [], customNames: [] })) {
        setConfirmSkip(false);
        done();
        return;
      }
      toast.error(toAppError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-40 pt-6 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary">{t('onboarding.trades.title')}</h1>
        <p className="mt-1.5 text-sm text-muted">{t('onboarding.trades.subtitle')}</p>

        <div className="mt-5 grid grid-cols-2 gap-2.5" role="group" aria-label={t('onboarding.trades.title')}>
          {TRADE_VALUES.map((trade) => {
            const on = picked.includes(trade);
            return (
              <button
                key={trade}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(trade)}
                className={cn(
                  'flex min-h-[60px] items-center gap-2.5 rounded-card border px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                  on
                    ? 'border-brand bg-brand-50 text-brand-700 ring-1 ring-brand'
                    : 'border-border bg-surface text-primary active:bg-surface-sunken',
                )}
              >
                <span className="text-xl" aria-hidden>{TRADE_EMOJI[trade]}</span>
                {/* «Металоконструкції» is one word wider than half a 375 px screen: hyphenate it in
                    Ukrainian where the phone can, break it anywhere where it cannot — never cut it. */}
                <span lang="uk" className="min-w-0 flex-1 leading-tight [hyphens:auto] [overflow-wrap:anywhere]">
                  {t('trades.' + trade)}
                </span>
                {on && <span aria-hidden className="text-brand">✓</span>}
              </button>
            );
          })}
        </div>

        <section className="mt-5">
          <h2 className="mb-1.5 text-sm font-semibold text-primary">{t('onboarding.trades.customTitle')}</h2>
          {(existingCustom.length > 0 || customNames.length > 0) && (
            <ul className="mb-2 space-y-1.5">
              {existingCustom.map((c) => (
                <li key={c.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  {CUSTOM_TRADE_EMOJI} {c.name}
                </li>
              ))}
              {customNames.map((name) => (
                <li key={name} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <span className="truncate">{CUSTOM_TRADE_EMOJI} {name}</span>
                  <button
                    type="button"
                    className="flex-shrink-0 text-xs font-semibold text-danger"
                    onClick={() => setCustomNames((prev) => prev.filter((n) => n !== name))}
                  >
                    {t('common.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {addingCustom ? (
            <div className="space-y-1.5">
              <Input
                autoFocus
                aria-label={t('onboarding.trades.customTitle')}
                placeholder={t('profile.customTradeNamePlaceholder')}
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addCustomName(); }
                }}
              />
              <p className="text-xs text-muted">{t('onboarding.trades.customNote')}</p>
              <div className="flex gap-2">
                <Button variant="secondary" fullWidth onClick={() => { setAddingCustom(false); setCustomDraft(''); }}>
                  {t('common.cancel')}
                </Button>
                <Button fullWidth onClick={addCustomName}>{t('common.add')}</Button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-brand" onClick={() => setAddingCustom(true)}>
              {t('profile.addCustomTrade')}
            </button>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          <Button fullWidth disabled={nothingChosen} loading={saving} onClick={() => void onSave()}>
            {t('onboarding.trades.next')}
          </Button>
          {/* After the trade: the same answer saved, then a ready estimate of THAT trade to look at —
              outside the two free objects. Online only (the server fills it). */}
          {picked.length > 0 && (
            <Button variant="secondary" fullWidth className="mt-2" loading={sample.creating}
              disabled={saving || !sample.online} title={sample.offlineTitle}
              onClick={() => sample.open(picked[0], saveTrades)}>
              {t('sample.openForTrade')}
            </Button>
          )}
          <button
            type="button"
            className="mt-2 w-full py-1.5 text-center text-sm text-muted underline"
            onClick={() => setConfirmSkip(true)}
          >
            {t('onboarding.trades.skip')}
          </button>
        </div>
      </div>

      <Modal open={confirmSkip} onClose={() => setConfirmSkip(false)} title={t('onboarding.trades.skipTitle')}>
        <p className="text-sm text-primary">{t('onboarding.trades.skipBody')}</p>
        <p className="mt-2 text-sm text-muted">{t('onboarding.trades.skipLater')}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button fullWidth onClick={() => setConfirmSkip(false)}>{t('onboarding.trades.skipBack')}</Button>
          <Button variant="secondary" fullWidth loading={saving} onClick={() => void onSkip()}>{t('onboarding.trades.skipConfirm')}</Button>
        </div>
      </Modal>
    </div>
  );
}
