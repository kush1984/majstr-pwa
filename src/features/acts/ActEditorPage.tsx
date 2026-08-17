import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Modal } from '@/components/Modal.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { Badge } from '@/components/Badge.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { actsApi } from '@/api/acts.ts';
import { formatMoney, formatAmount } from '@/lib/format.ts';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { CatalogAutocomplete } from '@/features/estimate/CatalogAutocomplete.tsx';
import { routes } from '@/lib/config.ts';
import {
  useAct, useActProgress, useUpdateActHeader, useReplaceActItems, useSignActOffline, useDeleteAct,
} from './useActs.ts';
import { UNITS } from '@/api/types.ts';
import { ACT_STATUS_VARIANT } from '@/lib/labels.ts';
import type { ActProgressLine, ItemType, Unit, WorkActItemLine, WorkActKind } from '@/api/types.ts';

const ADDITIONAL_WARNED_KEY = 'majstr-acts-additional-warned';

interface Additional { name: string; type: ItemType; unit: Unit; unitPrice: string; quantity: string; }

/** Create/edit screen for one work act (acts iteration). Loads the act + the object's progress
 *  (each SIGNED-estimate line with done-so-far/remaining), lets the master tick lines (a tick fills
 *  the whole remainder) and add off-estimate works, then saves quantities + header. */
export function ActEditorPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  // Generated from one estimate's «Згенерувати акт» → scope the editor to that estimate only; from the
  // Acts tab → no scope, every SIGNED estimate is offered.
  const scopeEstimate = searchParams.get('scope');
  const navigate = useNavigate();
  const { t } = useTranslation();

  const act = useAct(id);
  const projectId = act.data?.projectId ?? '';
  const progress = useActProgress(projectId, Boolean(projectId));
  const updateHeader = useUpdateActHeader(id, projectId);
  const replaceItems = useReplaceActItems(id, projectId);
  const signOffline = useSignActOffline(id, projectId);
  const deleteAct = useDeleteAct(projectId);

  const signed = act.data?.status === 'SIGNED';

  // ---- header form + entered quantities (seeded once when data arrives) ----
  const [kind, setKind] = useState<WorkActKind>('INTERIM');
  const [issuedAt, setIssuedAt] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [contractRef, setContractRef] = useState('');
  const [advance, setAdvance] = useState('');
  const [showMaterials, setShowMaterials] = useState(true);
  const [showCumulative, setShowCumulative] = useState(true);
  const [qty, setQty] = useState<Record<string, string>>({}); // estimateItemId → quantity
  const [additional, setAdditional] = useState<Additional[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (seeded || !act.data) return;
    const a = act.data;
    setKind(a.kind);
    setIssuedAt(a.issuedAt);
    setPeriodFrom(a.periodFrom);
    setPeriodTo(a.periodTo);
    setContractRef(a.contractRef ?? '');
    setAdvance(a.advanceOffset == null ? '' : String(a.advanceOffset));
    setShowMaterials(a.showMaterials);
    setShowCumulative(a.showCumulative);
    const seededQty: Record<string, string> = {};
    const seededAdditional: Additional[] = [];
    for (const it of a.items) {
      if (it.estimateItemId) seededQty[it.estimateItemId] = String(it.quantity);
      else seededAdditional.push({ name: it.name, type: it.type, unit: it.unit, unitPrice: String(it.unitPrice), quantity: String(it.quantity) });
    }
    setQty(seededQty);
    setAdditional(seededAdditional);
    setSeeded(true);
  }, [act.data, seeded]);

  // Progress grouped by estimate. When scoped to one estimate (generated from its «Згенерувати акт»),
  // only that estimate's positions are shown; unscoped (from the Acts tab), every SIGNED estimate is.
  const groups = useMemo(() => {
    const byEstimate = new Map<string, { name: string; lines: ActProgressLine[] }>();
    for (const line of progress.data?.lines ?? []) {
      if (scopeEstimate && line.estimateId !== scopeEstimate) continue;
      const g = byEstimate.get(line.estimateId)
        ?? { name: estimateName(line.estimateName, line.estimateCreatedAt), lines: [] };
      g.lines.push(line);
      byEstimate.set(line.estimateId, g);
    }
    return [...byEstimate.entries()];
  }, [progress.data, scopeEstimate]);

  // Every SIGNED-estimate line by name → the estimates that carry it. An off-estimate «додаткова»
  // line whose name matches one warns the master it already lives in a real estimate (where it can be
  // ticked as done instead of added loose) — he decides. Spans ALL estimates, even hidden ones.
  const estimatesByLineName = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const line of progress.data?.lines ?? []) {
      const key = line.name.trim().toLowerCase();
      if (!key) continue;
      const set = map.get(key) ?? new Set<string>();
      set.add(estimateName(line.estimateName, line.estimateCreatedAt));
      map.set(key, set);
    }
    return map;
  }, [progress.data]);

  const num = (s: string): number => {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const total = useMemo(() => {
    let sum = 0;
    for (const line of progress.data?.lines ?? []) {
      sum += num(qty[line.estimateItemId] ?? '') * line.unitPrice;
    }
    for (const a of additional) sum += num(a.quantity) * num(a.unitPrice);
    return sum;
  }, [qty, additional, progress.data]);
  const payable = Math.max(0, total - num(advance));

  if (act.isPending || (Boolean(projectId) && progress.isPending)) {
    return <div className="py-16 text-center text-brand"><Spinner /></div>;
  }
  if (!act.data) {
    return <p className="py-10 text-center text-sm text-muted">{t('acts.loadError')}</p>;
  }

  const toggleLine = (line: ActProgressLine) => {
    setQty((q) => {
      const next = { ...q };
      if (num(next[line.estimateItemId] ?? '') > 0) delete next[line.estimateItemId];
      else next[line.estimateItemId] = String(line.remaining);
      return next;
    });
  };

  const buildItems = (): WorkActItemLine[] => {
    const lines: WorkActItemLine[] = [];
    for (const line of progress.data?.lines ?? []) {
      const q = num(qty[line.estimateItemId] ?? '');
      if (q > 0) {
        lines.push({
          estimateItemId: line.estimateItemId, estimateId: line.estimateId, type: line.type,
          name: line.name, category: line.category, unit: line.unit, unitPrice: line.unitPrice, quantity: q,
        });
      }
    }
    for (const a of additional) {
      if (num(a.quantity) > 0 && a.name.trim()) {
        lines.push({
          estimateItemId: null, estimateId: null, type: a.type, name: a.name.trim(),
          category: null, unit: a.unit, unitPrice: num(a.unitPrice), quantity: num(a.quantity),
        });
      }
    }
    return lines;
  };

  const onSave = async () => {
    try {
      await updateHeader.mutateAsync({
        kind, issuedAt, periodFrom, periodTo,
        contractRef: contractRef.trim() || null,
        advanceOffset: advance.trim() === '' ? null : num(advance),
        showMaterials, showCumulative,
      });
      await replaceItems.mutateAsync({ items: buildItems() });
      toast.success(t('acts.saved'));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onSign = async () => {
    if (!signerName.trim()) return;
    try {
      // Persist current edits first so the signed act reflects the screen.
      await updateHeader.mutateAsync({
        kind, issuedAt, periodFrom, periodTo,
        contractRef: contractRef.trim() || null,
        advanceOffset: advance.trim() === '' ? null : num(advance),
        showMaterials, showCumulative,
      });
      await replaceItems.mutateAsync({ items: buildItems() });
      await signOffline.mutateAsync(signerName.trim());
      setSignOpen(false);
      toast.success(t('acts.signed'));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onPdf = async () => {
    try {
      const { url, revoke } = await actsApi.fetchPdf(id);
      window.open(url, '_blank');
      setTimeout(revoke, 60_000);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const addAdditional = () => {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(ADDITIONAL_WARNED_KEY)) {
      localStorage.setItem(ADDITIONAL_WARNED_KEY, '1');
      toast.info(t('acts.additionalWarn'));
    }
    setAdditional((a) => [...a, { name: '', type: 'WORK', unit: 'M2', unitPrice: '', quantity: '' }]);
  };

  // «Оформити перевищення як додаткові роботи»: clamp the estimate line to its remainder and move
  // the overflow into a new additional-works row (off-estimate work the client must agree to).
  const convertExcess = (line: ActProgressLine) => {
    const entered = num(qty[line.estimateItemId] ?? '');
    const excess = entered - line.remaining;
    if (excess <= 0) return;
    setQty((q) => ({ ...q, [line.estimateItemId]: String(line.remaining) }));
    setAdditional((a) => [...a, {
      name: `${line.name} ${t('acts.excessSuffix')}`,
      type: line.type, unit: line.unit, unitPrice: String(line.unitPrice), quantity: String(excess),
    }]);
  };

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <div className="mb-3 flex items-center gap-3">
        <button type="button" onClick={() => navigate(routes.project(projectId) + '?tab=acts')}
          aria-label={t('common.back')}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary">←</button>
        <span className="text-sm font-semibold text-primary">
          {t('acts.title', { number: act.data.number })}
        </span>
        <Badge variant={ACT_STATUS_VARIANT[act.data.status]}>{t('acts.status.' + act.data.status)}</Badge>
      </div>

      {/* Header */}
      <div className="mb-4 space-y-3 rounded-card border border-border bg-surface p-3.5">
        <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
          {(['INTERIM', 'FINAL'] as WorkActKind[]).map((k) => (
            <button key={k} type="button" disabled={signed} onClick={() => setKind(k)}
              className={'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors '
                + (kind === k ? 'bg-white text-brand shadow-sm' : 'text-muted')}>
              {t('acts.kind.' + k)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('acts.periodFrom')}><Input type="date" value={periodFrom} disabled={signed} onChange={(e) => setPeriodFrom(e.target.value)} /></Field>
          <Field label={t('acts.periodTo')}><Input type="date" value={periodTo} disabled={signed} onChange={(e) => setPeriodTo(e.target.value)} /></Field>
        </div>
        <Field label={t('acts.issuedAt')}><Input type="date" value={issuedAt} disabled={signed} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
        <Field label={t('acts.contractRef')}><Input value={contractRef} disabled={signed} onChange={(e) => setContractRef(e.target.value)} /></Field>
        {!signed && (
          <Checkbox label={t('acts.showMaterials')} checked={showMaterials} onChange={() => setShowMaterials((v) => !v)} />
        )}
      </div>

      {/* Progress lines */}
      {groups.map(([estimateId, group]) => (
        <div key={estimateId} className="mb-4">
          <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-muted">{group.name}</h3>
          <div className="space-y-2">
            {group.lines
              .filter((line) => showMaterials || line.type !== 'MATERIAL')
              .map((line) => {
                const entered = num(qty[line.estimateItemId] ?? '');
                const exceeds = line.done + entered > line.estimateQuantity;
                return (
                  <div key={line.estimateItemId} className="rounded-card border border-border bg-surface p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" disabled={signed} checked={entered > 0}
                        onChange={() => toggleLine(line)} className="mt-1 h-5 w-5 accent-brand" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-primary">{line.name}</span>
                          <span className="whitespace-nowrap text-xs text-muted">{formatMoney(line.unitPrice)}/{t('units.' + line.unit)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {t('acts.lineProgress', {
                            estimate: formatAmount(line.estimateQuantity),
                            done: formatAmount(line.done),
                            remaining: formatAmount(line.remaining),
                            unit: t('units.' + line.unit),
                          })}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <Input type="text" inputMode="decimal" value={qty[line.estimateItemId] ?? ''} disabled={signed}
                            onChange={(e) => setQty((q) => ({ ...q, [line.estimateItemId]: e.target.value }))}
                            className="w-28" />
                          <span className="text-xs text-muted">{t('units.' + line.unit)}</span>
                          <span className="ml-auto text-sm font-semibold text-primary">{formatMoney(entered * line.unitPrice)}</span>
                        </div>
                        {exceeds && !signed && (
                          <div className="mt-1 rounded-lg bg-amber-50 p-2">
                            <p className="text-xs text-amber-700">{t('acts.exceeds')}</p>
                            <button type="button" onClick={() => convertExcess(line)}
                              className="mt-1 text-xs font-semibold text-brand">{t('acts.convertExcess')}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      {/* Additional works */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">{t('acts.additionalTitle')}</h3>
          <InfoPopover text={t('acts.additionalInfo')} />
        </div>
        <div className="space-y-2">
          {additional.map((a, i) => {
            const dupEstimates = [...(estimatesByLineName.get(a.name.trim().toLowerCase()) ?? [])];
            return (
            <div key={i} className="rounded-card border border-border bg-surface p-3">
              {signed ? (
                <Input value={a.name} disabled />
              ) : (
                <CatalogAutocomplete
                  value={a.name}
                  placeholder={t('acts.additionalName')}
                  onChange={(text) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, name: text } : x))}
                  onPick={(item) => setAdditional((list) => list.map((x, j) => j === i
                    ? { ...x, name: item.name, type: item.type, unit: item.unit, unitPrice: String(item.defaultPrice) }
                    : x))}
                />
              )}
              {!signed && dupEstimates.length > 0 && (
                <p className="mt-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                  {t('acts.additionalDuplicate', { names: dupEstimates.join(', ') })}
                </p>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Select value={a.unit} disabled={signed}
                  onChange={(e) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, unit: e.target.value as Unit } : x))}>
                  {UNITS.map((code) => <option key={code} value={code}>{t('units.' + code)}</option>)}
                </Select>
                <Input inputMode="decimal" placeholder={t('acts.qty')} value={a.quantity} disabled={signed}
                  onChange={(e) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                <Input inputMode="decimal" placeholder={t('acts.price')} value={a.unitPrice} disabled={signed}
                  onChange={(e) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} />
              </div>
              {!signed && (
                <button type="button" className="mt-1.5 text-xs font-semibold text-danger"
                  onClick={() => setAdditional((list) => list.filter((_, j) => j !== i))}>{t('common.delete')}</button>
              )}
            </div>
            );
          })}
        </div>
        {!signed && (
          <button type="button" onClick={addAdditional} className="mt-2 text-sm font-semibold text-brand">
            {t('acts.addAdditional')}
          </button>
        )}
      </div>

      {/* Advance + totals */}
      {!signed && (
        <Field label={t('acts.advance')}>
          <Input inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} className="max-w-[200px]" />
        </Field>
      )}
      <div className="mt-3 space-y-1 rounded-card border border-border bg-surface-sunken p-3.5 text-sm">
        <Row label={t('acts.total')} value={formatMoney(total)} />
        {num(advance) > 0 && <Row label={t('acts.advanceShort')} value={'− ' + formatMoney(num(advance))} />}
        <Row label={t('acts.payable')} value={formatMoney(payable)} bold />
      </div>
      {!signed && (
        <div className="mt-2">
          <Checkbox label={t('acts.showCumulative')} checked={showCumulative} onChange={() => setShowCumulative((v) => !v)} />
        </div>
      )}

      {/* Actions — a speed-dial FAB so the master reaches Save/Sign/PDF/Delete from anywhere on a
          long editor without scrolling to the bottom. Ordered so the primary Save sits nearest the
          thumb and the destructive Delete sits farthest from it. */}
      <Fab ariaLabel={t('acts.actionsMenu')}>
        {(close) => (
          <>
            {(act.data.status === 'DRAFT' || act.data.status === 'REJECTED') && (
              <FabAction icon="🗑" label={t('common.delete')} onClick={() => close(() => setConfirmDelete(true))} />
            )}
            <FabAction icon="📄" label={t('acts.pdf')} onClick={() => close(() => void onPdf())} />
            {!signed && (
              <FabAction icon="✍️" label={t('acts.sign')} onClick={() => close(() => setSignOpen(true))} />
            )}
            {!signed && (
              <FabAction icon="💾" label={t('common.save')} onClick={() => close(() => void onSave())} />
            )}
          </>
        )}
      </Fab>

      <Modal open={signOpen} onClose={() => setSignOpen(false)} title={t('acts.signTitle')}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('acts.signHint')}</p>
          <Input placeholder={t('acts.signerName')} value={signerName} onChange={(e) => setSignerName(e.target.value)} />
          <Button fullWidth loading={signOffline.isPending} disabled={!signerName.trim()} onClick={() => void onSign()}>
            {t('acts.signConfirm')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog open={confirmDelete} title={t('acts.deleteTitle')} message={t('acts.deleteConfirm')}
        confirmLabel={t('common.delete')} loading={deleteAct.isPending}
        onConfirm={() => deleteAct.mutate(id, {
          onSuccess: () => { void navigate(routes.project(projectId) + '?tab=acts'); },
          onError: (err) => toast.error(toAppError(err).message),
        })}
        onClose={() => setConfirmDelete(false)} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={'flex justify-between ' + (bold ? 'font-bold text-primary' : 'text-secondary')}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
