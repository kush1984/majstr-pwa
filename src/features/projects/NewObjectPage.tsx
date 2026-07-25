import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { FormField } from '@/components/FormField.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
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

/**
 * "Object only" flow: create a project (optionally with a client) without an
 * estimate, then open it. Estimates are added later from the object screen.
 * Same FREE object cap as the combined flow.
 */
export function NewObjectPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const createClient = useCreateClient();
  const createProject = useCreateProject();
  const projects = useProjects();
  const limits = usePlanLimits();
  const atProjectLimit = isAtLimit(projects.data?.length ?? 0, limits.data?.maxProjects);

  const [clientDraft, setClientDraft] = useState<ClientDraft>(emptyClientDraft);
  const [project, setProject] = useState({ name: '', address: '' });
  const [busy, setBusy] = useState(false);

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
      void navigate(routes.project(proj.id), { replace: true });
    } catch (err) {
      toast.error(toAppError(err).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(routes.projects)}
            aria-label={t('common.back')}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-primary">
            {t('estimate.newObjectTitle')}
          </h1>
        </div>

        {/* Object */}
        <section className="mb-5">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-primary">
            {t('estimate.object')}
          </h2>
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
          </div>
        </section>

        {/* Client — optional; can be added later, before sending an estimate. */}
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-primary">
            {t('estimate.client')}
          </h2>
          <ClientPicker value={clientDraft} onChange={setClientDraft} />
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
    </div>
  );
}
