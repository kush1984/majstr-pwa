import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { FormField } from '@/components/FormField.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import { routes } from '@/lib/config.ts';
import { useCreateEstimate } from '@/features/estimate/useEstimate.ts';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { useCreateClient } from '@/features/clients/useClients.ts';
import {
  ClientPicker,
  clientDraftError,
  emptyClientDraft,
  resolveClientId,
  type ClientDraft,
} from '@/features/clients/ClientPicker.tsx';
import { useCreateProject, useProjects } from '@/features/projects/useProjects.ts';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';
import { TemplatePickerSheet, type TemplatePick } from '@/features/estimate/TemplatePickerSheet.tsx';
import { TemplateNotCachedError, useApplyTemplate } from '@/features/estimate/useEstimateTemplates.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';

/**
 * "Object + estimate" flow: optionally pick/create a client, name the object,
 * then we create client (if new) → project → estimate and open the editor.
 * The client is OPTIONAL here (you can add one later, before sending). One
 * screen, no wizard. This screen always creates a NEW project, so the FREE
 * object cap applies.
 */
export function NewEstimatePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const createClient = useCreateClient();
  const createProject = useCreateProject();
  const createEstimate = useCreateEstimate();
  // Guard here too (besides the disabled button on the list) for direct nav.
  const projects = useProjects();
  const limits = usePlanLimits();
  const atProjectLimit = isAtLimit(projects.data?.length ?? 0, limits.data?.maxProjects);

  const [clientDraft, setClientDraft] = useState<ClientDraft>(emptyClientDraft);
  const [project, setProject] = useState({ name: '', address: '' });
  const [estName, setEstName] = useState('');
  const [busy, setBusy] = useState(false);
  // Empty estimate vs. start from templates (positions pre-filled, prices from the master's
  // catalog). The picker hands back every chosen bundle — with the positions ticked inside it,
  // since a big bundle is often applied for five or six of its lines; several merge into ONE
  // estimate.
  const [templates, setTemplates] = useState<TemplatePick[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Import mode: create the object, then hand off to the file/photo import wizard.
  const [importMode, setImportMode] = useState(false);
  const applyTemplate = useApplyTemplate();
  // "From a template" / "from a file" both build the estimate server-side — offline the master
  // gets an empty estimate, which the outbox can replay.
  const { online, guard, offlineTitle } = useOnlineGuard();

  const submit = async () => {
    if (busy) return;
    if (atProjectLimit) {
      toast.error(t('limits.objectsHint', { max: limits.data?.maxProjects }));
      return;
    }

    const clientErr = clientDraftError(clientDraft);
    if (clientErr) {
      toast.error(t(clientErr));
      return;
    }
    if (!project.name.trim() || !project.address.trim()) {
      toast.error(t('estimate.enterObjectNameAddress'));
      return;
    }

    setBusy(true);
    try {
      const clientId = await resolveClientId(clientDraft, createClient);
      const proj = await createProject.mutateAsync({
        name: project.name.trim(),
        address: project.address.trim(),
        clientId,
      });
      // Import path: the object exists now; the wizard fills the estimate from a file/photo.
      if (importMode) {
        void navigate(routes.importEstimate(proj.id), { replace: true });
        return;
      }
      const req = { name: estName.trim() || undefined };
      const estimate = templates.length > 0
        ? await applyTemplate.mutateAsync({
            projectId: proj.id,
            picks: templates.map((p) => ({
              templateId: p.template.id,
              itemIds: p.itemIds ?? undefined,
            })),
            req,
          })
        : await createEstimate.mutateAsync({ projectId: proj.id, req });
      void navigate(routes.estimate(estimate.id), { replace: true });
    } catch (err) {
      // A template whose composition was never cached can't be applied offline — say so
      // usefully ("open it once online") instead of surfacing the raw bundle key.
      toast.error(err instanceof TemplateNotCachedError
        ? t('offline.templateNotCached')
        : toAppError(err).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(routes.home)}
            aria-label={t('common.back')}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-primary">{t('estimate.newTitle')}</h1>
        </div>

        {/* Lead choice: empty estimate vs. start from a template (defaults + my own). */}
        <section className="mb-5">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-primary">
            {t('templates.chooseType')}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setTemplates([]);
                setImportMode(false);
              }}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                templates.length === 0 && !importMode
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-primary',
              )}
            >
              {t('templates.emptyEstimate')}
            </button>
            {/* Works offline: the picker reads the cached template list, and applying one is
                composed on the device (see useApplyTemplate). Only the file/photo import below
                still needs the server. */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={cn(
                'truncate rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                templates.length > 0 && !importMode
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-primary',
              )}
            >
              {templates.length === 1
                ? t('templates.chosen', { name: templates[0].template.name })
                : templates.length > 1
                  ? t('templates.applyCount', { count: templates.length })
                  : t('templates.fromTemplate')}
            </button>
          </div>
          {/* Third option: import a ready estimate from a file/photo (PRO — gated on the wizard). */}
          <button
            type="button"
            onClick={guard(() => {
              setImportMode(true);
              setTemplates([]);
            })}
            disabled={!online}
            title={offlineTitle}
            className={cn(
              'mt-2 w-full rounded-xl border px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-50',
              importMode ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-surface text-primary',
            )}
          >
            {t('templates.fromFile')}
          </button>
        </section>

        {/* Client — optional; can be added later, before sending the estimate. */}
        <section className="mb-5">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-primary">
            {t('estimate.client')}
          </h2>
          <ClientPicker value={clientDraft} onChange={setClientDraft} />
        </section>

        {/* Object */}
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-primary">{t('estimate.object')}</h2>
          <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
            <FormField label={t('common.name')} htmlFor="pr-name" required hint={t('estimate.objectNameHint')}>
              <Input
                id="pr-name"
                value={project.name}
                onChange={(e) => setProject((s) => ({ ...s, name: e.target.value }))}
              />
            </FormField>
            <FormField label={t('common.address')} htmlFor="pr-addr" required>
              <Input
                id="pr-addr"
                placeholder={t('estimate.addressPlaceholder')}
                value={project.address}
                onChange={(e) => setProject((s) => ({ ...s, address: e.target.value }))}
              />
            </FormField>
            <FormField label={t('estimate.nameLabel')} htmlFor="est-name" hint={t('estimate.nameHint')}>
              <Input
                id="est-name"
                maxLength={255}
                placeholder={t('estimate.namePlaceholder')}
                value={estName}
                onChange={(e) => setEstName(e.target.value)}
              />
            </FormField>
          </div>
        </section>

        {atProjectLimit && (
          <UpgradeBanner text={t('limits.objectsHint', { max: limits.data?.maxProjects })} trigger="OBJECT_LIMIT" />
        )}
        <Button
          fullWidth
          loading={busy}
          disabled={atProjectLimit}
          onClick={submit}
          className="py-4 text-base shadow-cta"
        >
          {t('estimate.createEstimate')}
        </Button>
      </div>

      <TemplatePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(tpls) => {
          setTemplates(tpls);
          setImportMode(false);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
