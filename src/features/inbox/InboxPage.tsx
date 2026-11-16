import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { estimatesApi } from '@/api/estimates.ts';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { InlineNumberCell } from '@/components/InlineNumberCell.tsx';
import { InlineTextCell } from '@/components/InlineTextCell.tsx';
import { useSpeechDictation } from '@/hooks/useSpeechDictation.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
import { formatMoney } from '@/lib/format.ts';
import { useProjects, isTerminalStage } from '@/features/projects/useProjects.ts';
import { useMe } from '@/features/auth/useMe.ts';
import {
  CASH_EXPENSE_CATEGORIES, CASH_INCOME_CATEGORIES, UNITS,
  type InboxEntryView, type InboxItemKind, type InboxItemView, type InboxOutcome,
} from '@/api/types.ts';
import { useInbox, useInboxActions, useTelegram } from './useInbox.ts';

const KIND_ICON: Record<InboxItemKind, string> = {
  SHOPPING: '🛒', TASK: '☑️', NOTE: '📝', ESTIMATE_LINE: '📋', EXPENSE: '💸', INCOME: '💰',
};
const KINDS: InboxItemKind[] = ['TASK', 'SHOPPING', 'NOTE', 'ESTIMATE_LINE', 'EXPENSE', 'INCOME'];
const isMoney = (kind: InboxItemKind) => kind === 'EXPENSE' || kind === 'INCOME';

/**
 * «Вхідні» (majster-bot) — a quick note typed or dictated here or sent to the Telegram bot, and
 * whatever of it could not be filed by itself: no object named, no price in the catalog, and
 * money, which always waits for «Записати». Everything is fixed IN the row it shows in.
 */
export function InboxPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inbox = useInbox();
  const telegram = useTelegram();
  const actions = useInboxActions();
  const [text, setText] = useState('');

  const speech = useSpeechDictation({
    onFinal: (heard) => setText((old) => (old.trim() ? `${old.trim()} ${heard}` : heard)),
  });

  const submit = () => {
    const note = text.trim();
    if (!note) return;
    speech.stop();
    actions.create.mutate(note, {
      onSuccess: () => toast.success(t('inbox.sent')),
      onError: (err) => toast.error(toAppError(err).message),
    });
    setText('');
  };

  const entries = inbox.data ?? [];
  // A FREE account with an unconfirmed address gets no parse (the server's AiAccess, as for dictation).
  const me = useMe();
  const needsVerifiedEmail = me.data?.plan === 'FREE' && me.data.emailVerified === false;

  return (
    <div className="ph-mask min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(routes.home)}
            aria-label={t('common.back')}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-primary">{t('inbox.title')}</h1>
            <p className="truncate text-xs text-muted">{t('inbox.subtitle')}</p>
          </div>
        </div>

        {needsVerifiedEmail && (
          <p className="mb-3 rounded-card border border-warning/40 bg-warning/10 p-2.5 text-sm text-secondary">{t('inbox.verifyEmail')}</p>
        )}
        <form
          className="mb-3 rounded-card border border-border bg-surface p-3"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <textarea
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('inbox.placeholder')}
            aria-label={t('inbox.placeholder')}
            className="w-full resize-none bg-transparent text-base text-primary placeholder:text-muted focus:outline-none"
          />
          {speech.listening && speech.interim && (
            <p className="mb-2 text-sm italic text-muted">{speech.interim}</p>
          )}
          <div className="flex items-center gap-2">
            {speech.available && (
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                aria-pressed={speech.listening}
                aria-label={speech.listening ? t('inbox.micStop') : t('inbox.micStart')}
                className={`flex h-11 w-11 items-center justify-center rounded-full text-lg ${
                  speech.listening ? 'bg-danger text-white' : 'bg-surface-sunken text-primary'}`}
              >
                {speech.listening ? '■' : '🎤'}
              </button>
            )}
            <Button type="submit" className="ml-auto" disabled={!text.trim()}>{t('inbox.send')}</Button>
          </div>
        </form>

        {telegram.data?.available && !telegram.data.linked && (
          <button
            type="button"
            onClick={() => navigate(routes.profile)}
            className="mb-5 flex min-h-11 w-full items-center gap-2 rounded-card bg-brand-soft px-3.5 py-2 text-left text-sm font-semibold text-brand"
          >
            <span aria-hidden>✈️</span>
            <span className="flex-1">{t('inbox.telegramHint')}</span>
            <span aria-hidden>›</span>
          </button>
        )}

        {inbox.isPending ? (
          <div className="py-8 text-center text-brand"><Spinner /></div>
        ) : inbox.isError && !inbox.data ? (
          <ErrorState error={inbox.error} title={t('inbox.loadError')} onRetry={() => { void inbox.refetch(); }} />
        ) : entries.length === 0 ? (
          <EmptyState icon="📥" title={t('inbox.emptyTitle')} text={t('inbox.emptyText')} />
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => <EntryCard key={entry.id} entry={entry} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: InboxEntryView }) {
  const { t, i18n } = useTranslation();
  const actions = useInboxActions();
  const onError = (err: unknown) => toast.error(toAppError(err).message);
  const applied = entry.items.filter((i) => i.status === 'APPLIED');
  const waiting = entry.items.filter((i) => i.status === 'PENDING');
  const time = new Date(entry.createdAt).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="rounded-card border border-border bg-surface p-3.5">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span aria-hidden>{entry.voice === true ? '🎙' : entry.source === 'TELEGRAM' ? '✈️' : '📱'}</span>
        <span>{entry.source === 'TELEGRAM' ? 'Telegram' : t('inbox.fromApp')} · {time}</span>
        <button
          type="button"
          onClick={() => actions.discard.mutate(entry.id, { onError })}
          className="-my-2 ml-auto min-h-11 px-2 font-semibold text-muted"
        >
          {t('inbox.discardAll')}
        </button>
      </div>
      <p className="mb-3 whitespace-pre-wrap break-words text-sm text-secondary">«{entry.rawText}»</p>

      {entry.status === 'PARSING' && (
        <p className="text-sm text-muted">{t('inbox.parsing')}</p>
      )}
      {entry.status === 'FAILED' && (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm text-warning">{t('inbox.failed')}</p>
          <Button variant="secondary" loading={actions.retry.isPending}
            onClick={() => actions.retry.mutate(entry.id, { onSuccess: reportFailures(t), onError })}>
            {t('inbox.retry')}
          </Button>
        </div>
      )}
      {entry.status === 'NEW' && entry.items.length === 0 && (
        <p className="text-sm text-muted">{t('inbox.nothingFound')}</p>
      )}

      {applied.length > 0 && (
        <ul className="mb-2 space-y-1">
          {applied.map((item) => (
            <li key={item.id} className="text-sm text-muted">
              ✅ {KIND_ICON[item.kind]} {item.text}{item.projectName ? ` · ${item.projectName}` : ''}
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <div className="space-y-2">
          {waiting.map((item) => <ItemEditor key={item.id} item={item} />)}
        </div>
      )}
      {waiting.some((item) => item.issue === 'NO_DRAFT') && (
        <Button
          fullWidth
          variant="secondary"
          className="mt-2"
          loading={actions.createDraft.isPending}
          onClick={() => actions.createDraft.mutate(entry.id, {
            onSuccess: (outcome) => {
              if (outcome.notice === 'ESTIMATE_LIMIT') toast.error(t('inbox.estimateLimit'));
              reportFailures(t)(outcome);
            },
            onError,
          })}
        >
          📋 {t('inbox.createDraft')}
        </Button>
      )}
      {applied.length > 0 && (
        <button
          type="button"
          onClick={() => actions.undo.mutate(entry.id, { onSuccess: reportFailures(t), onError })}
          className="mt-1 min-h-11 text-[13px] font-semibold text-muted"
        >
          ↩️ {t('inbox.undo')}
        </button>
      )}
    </div>
  );
}

function ItemEditor({ item }: { item: InboxItemView }) {
  const { t } = useTranslation();
  const actions = useInboxActions();
  const projects = useProjects();
  // The training sample is never a choice: money under it is read by no figure (as on the server).
  const objects = (projects.data ?? []).filter((p) => !isTerminalStage(p.stage) && p.sample !== true);
  const onError = (err: unknown) => toast.error(toAppError(err).message);
  const update = (req: Parameters<typeof actions.updateItem.mutate>[0]['req']) =>
    actions.updateItem.mutate({ itemId: item.id, req }, { onError });
  const canApply = item.issue === undefined || item.issue === 'CONFIRM';
  const categories = item.kind === 'INCOME' ? CASH_INCOME_CATEGORIES : CASH_EXPENSE_CATEGORIES;

  return (
    <div className="rounded-xl bg-surface-sunken p-3">
      <div className="flex items-start gap-2">
        <select
          value={item.kind}
          aria-label={t('inbox.kind')}
          onChange={(e) => update({ kind: e.target.value as InboxItemKind })}
          className="min-h-11 flex-shrink-0 rounded-lg bg-surface px-1 text-base"
        >
          {KINDS.map((k) => <option key={k} value={k}>{KIND_ICON[k]} {t(`inbox.kinds.${k}`)}</option>)}
        </select>
        <div className="min-w-0 flex-1 pt-1 text-sm font-semibold text-primary">
          <InlineTextCell value={item.text} ariaLabel={t('inbox.text')} maxLength={2000}
            onCommit={(next) => update({ text: next })} />
        </div>
        <button type="button" aria-label={t('inbox.discardItem')}
          onClick={() => actions.discardItem.mutate(item.id, { onError })}
          className="-my-1.5 -mr-1.5 flex h-11 w-11 flex-shrink-0 items-center justify-center text-muted">✕</button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={item.projectId ?? ''}
          aria-label={t('inbox.object')}
          onChange={(e) => update(e.target.value === '' ? { clearProject: true } : { projectId: e.target.value })}
          className={`min-h-11 max-w-full rounded-lg bg-surface px-2 text-base ${item.issue === 'OBJECT' ? 'text-warning' : 'text-primary'}`}
        >
          <option value="">{isMoney(item.kind) ? t('inbox.noObjectMoney') : t('inbox.pickObject')}</option>
          {objects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {(item.kind === 'SHOPPING' || item.kind === 'ESTIMATE_LINE') && (
          <>
            <InlineNumberCell
              value={item.quantity ?? 0}
              kind="quantity"
              ariaLabel={t('inbox.quantity')}
              tone={item.quantity === undefined ? 'warn' : 'default'}
              display={item.quantity === undefined ? t('inbox.quantityMissing') : undefined}
              onCommit={(quantity) => update({ quantity })}
            />
            <select
              value={item.unit ?? ''}
              aria-label={t('inbox.unit')}
              onChange={(e) => { if (e.target.value) update({ unit: e.target.value as typeof UNITS[number] }); }}
              className="min-h-11 rounded-lg bg-surface px-1 text-base"
            >
              <option value="">—</option>
              {UNITS.filter((u) => u !== 'PERCENT').map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
            </select>
          </>
        )}
        {item.kind === 'ESTIMATE_LINE' && item.issue === 'ESTIMATE' && item.projectId !== undefined && (
          <EstimatePicker projectId={item.projectId} onPick={(estimateId) => update({ estimateId })} />
        )}
        {item.kind === 'ESTIMATE_LINE' && (
          <InlineNumberCell
            value={item.unitPrice ?? 0}
            kind="money"
            ariaLabel={t('inbox.price')}
            tone={item.unitPrice === undefined ? 'warn' : 'default'}
            display={item.unitPrice === undefined ? t('inbox.priceMissing') : formatMoney(item.unitPrice)}
            onCommit={(unitPrice) => update({ unitPrice })}
          />
        )}
        {isMoney(item.kind) && (
          <InlineNumberCell
            value={item.amount ?? 0}
            kind="money"
            ariaLabel={t('inbox.amount')}
            tone={item.amount === undefined ? 'warn' : 'default'}
            display={item.amount === undefined ? t('inbox.amountMissing') : formatMoney(item.amount)}
            onCommit={(amount) => update({ amount })}
          />
        )}
      </div>

      {isMoney(item.kind) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button key={c} type="button" aria-pressed={item.category === c}
              onClick={() => update({ category: c })}
              className={`min-h-9 rounded-full px-3 text-xs font-semibold ${
                item.category === c ? 'bg-brand-soft text-brand' : 'bg-surface text-secondary'}`}>
              {t(`cashCategory.${c}`)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {item.issue !== undefined && item.issue !== 'CONFIRM' && (
          <p className="flex-1 text-xs text-warning">{t(`inbox.issues.${item.issue}`)}</p>
        )}
        <Button
          className="ml-auto"
          disabled={!canApply}
          loading={actions.applyItem.isPending && actions.applyItem.variables === item.id}
          onClick={() => actions.applyItem.mutate(item.id, { onSuccess: reportFailures(t), onError })}
        >
          {t('inbox.apply')}
        </Button>
      </div>
    </div>
  );
}

/** The object has several open estimates: the line goes into the one the master picks. */
function EstimatePicker({ projectId, onPick }: { projectId: string; onPick: (estimateId: string) => void }) {
  const { t } = useTranslation();
  const estimates = useQuery({
    queryKey: ['project-estimates', projectId],
    queryFn: () => estimatesApi.listForProject(projectId),
  });
  const open = (estimates.data ?? []).filter((e) => e.status === 'DRAFT' || e.status === 'SENT');
  return (
    <select
      value=""
      aria-label={t('inbox.pickEstimate')}
      onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
      className="min-h-11 max-w-full rounded-lg bg-surface px-2 text-base text-warning"
    >
      <option value="">{t('inbox.pickEstimate')}</option>
      {open.map((e) => <option key={e.id} value={e.id}>{e.name ?? t('inbox.untitledEstimate')}</option>)}
    </select>
  );
}

/** A service that refused an item (an estimate signed in between, a label taken) says so. */
function reportFailures(t: (key: string, opts?: Record<string, unknown>) => string) {
  return (outcome: InboxOutcome) => {
    if (outcome.notice === 'VERIFY_EMAIL') toast.error(t('inbox.verifyEmail'));
    if (outcome.failures.length > 0) {
      toast.error(t('inbox.applyFailed', { text: outcome.failures.join(', ') }));
    }
  };
}
