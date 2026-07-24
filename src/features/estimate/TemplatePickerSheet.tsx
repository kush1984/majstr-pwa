import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import type { EstimateTemplateSummary } from '@/api/types.ts';
import { useEstimateTemplate, useEstimateTemplates } from './useEstimateTemplates.ts';

/**
 * Picks an estimate template: lists the master's own templates and the system
 * defaults grouped by trade, lets them preview a template's composition, then
 * hands the chosen one back via `onPick`. The caller decides what to do with it
 * (apply to a new / existing project) — so this sheet is reusable from both the
 * new-estimate flow and a project screen. Selection only: rename / delete /
 * editing positions all live on the "Шаблони" page, not in this picker.
 */
export function TemplatePickerSheet({
  open,
  onClose,
  onPick,
  applying = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: EstimateTemplateSummary) => void;
  applying?: boolean;
}) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useEstimateTemplates();
  const [preview, setPreview] = useState<EstimateTemplateSummary | null>(null);

  const own = useMemo(() => (data ?? []).filter((t) => !t.isDefault), [data]);
  const defaultsByTrade = useMemo(() => {
    const groups = new Map<string, EstimateTemplateSummary[]>();
    for (const tpl of (data ?? []).filter((t) => t.isDefault)) {
      const key = tpl.trade ?? 'GENERAL';
      const bucket = groups.get(key);
      if (bucket) bucket.push(tpl);
      else groups.set(key, [tpl]);
    }
    return [...groups.entries()];
  }, [data]);

  const close = () => {
    setPreview(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={preview ? preview.name : t('templates.pickTitle')}>
      {preview ? (
        <TemplatePreview
          template={preview}
          applying={applying}
          onBack={() => setPreview(null)}
          onApply={() => onPick(preview)}
        />
      ) : isPending ? (
        <div className="flex justify-center py-8 text-brand">
          <Spinner />
        </div>
      ) : isError ? (
        <p className="py-6 text-center text-sm text-muted">{t('templates.loadError')}</p>
      ) : (
        <div className="space-y-5">
          {/* My templates */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.myTemplates')}
            </h3>
            {own.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted">
                {t('templates.emptyMy')}
              </p>
            ) : (
              <div className="space-y-1.5">
                {own.map((tpl) => (
                  <TemplateRow key={tpl.id} template={tpl} onOpen={() => setPreview(tpl)} />
                ))}
              </div>
            )}
          </section>

          {/* Default templates, grouped by trade */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.defaultTemplates')}
            </h3>
            {defaultsByTrade.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted">
                {t('templates.emptyNone')}
              </p>
            ) : (
              <div className="space-y-4">
                {defaultsByTrade.map(([trade, items]) => (
                  <div key={trade}>
                    <div className="mb-1.5 text-xs font-semibold text-muted">
                      {TRADE_EMOJI[trade as keyof typeof TRADE_EMOJI] ?? '📦'} {t('trades.' + trade)}
                    </div>
                    <div className="space-y-1.5">
                      {items.map((tpl) => (
                        <TemplateRow key={tpl.id} template={tpl} onOpen={() => setPreview(tpl)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function TemplateRow({
  template,
  onOpen,
}: {
  template: EstimateTemplateSummary;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-primary">{template.name}</span>
        <span className="block text-xs text-muted">
          {t('templates.itemsCount', { count: template.itemCount })}
        </span>
      </span>
    </button>
  );
}

function TemplatePreview({
  template,
  applying,
  onBack,
  onApply,
}: {
  template: EstimateTemplateSummary;
  applying: boolean;
  onBack: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const { data, isPending } = useEstimateTemplate(template.id);

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-xs font-semibold text-brand">
        ← {t('common.back')}
      </button>
      <p className="mb-3 text-xs text-muted">{t('templates.pricesHint')}</p>
      {isPending ? (
        <div className="flex justify-center py-6 text-brand">
          <Spinner />
        </div>
      ) : (
        <div className="mb-5 max-h-[40dvh] space-y-1 overflow-y-auto">
          {(data?.items ?? []).map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words text-primary">{item.name}</span>
              <span className="flex-shrink-0 text-xs text-muted">{t('units.' + item.unit)}</span>
            </div>
          ))}
        </div>
      )}
      <Button fullWidth loading={applying} onClick={onApply}>
        {t('templates.apply')}
      </Button>
    </div>
  );
}
