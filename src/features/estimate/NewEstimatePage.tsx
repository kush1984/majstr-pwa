import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { initials } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { routes } from '@/lib/config.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { useClients, useCreateClient } from '@/features/clients/useClients.ts';
import { useCreateProject, useProjects } from '@/features/projects/useProjects.ts';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';

/**
 * Inline-creation flow: pick or create a client, name the object, then we
 * create client (if new) → project → empty estimate and open the editor.
 * One screen, no wizard.
 */
export function NewEstimatePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clients = useClients();
  const createClient = useCreateClient();
  const createProject = useCreateProject();
  // This screen always creates a NEW project, so the FREE object cap applies.
  // Guard here too (besides the disabled button on the list) for direct nav.
  const projects = useProjects();
  const limits = usePlanLimits();
  const atProjectLimit = isAtLimit(projects.data?.length ?? 0, limits.data?.maxProjects);

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newClient, setNewClient] = useState({ fullName: '', phone: '', email: '' });
  const [project, setProject] = useState({ name: '', address: '' });
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = clients.data ?? [];
    return needle ? list.filter((c) => c.fullName.toLowerCase().includes(needle)) : list;
  }, [clients.data, search]);

  const submit = async () => {
    if (busy) return;
    if (atProjectLimit) {
      toast.error(t('limits.objectsHint', { max: limits.data?.maxProjects }));
      return;
    }

    if (mode === 'new' && (!newClient.fullName.trim() || !newClient.phone.trim())) {
      toast.error(t('estimate.enterClientNamePhone'));
      return;
    }
    if (mode === 'existing' && !selectedId) {
      toast.error(t('estimate.chooseOrCreateClient'));
      return;
    }
    if (!project.name.trim() || !project.address.trim()) {
      toast.error(t('estimate.enterObjectNameAddress'));
      return;
    }

    setBusy(true);
    try {
      let clientId = selectedId;
      if (mode === 'new') {
        const c = await createClient.mutateAsync({
          fullName: newClient.fullName.trim(),
          phone: newClient.phone.trim(),
          email: newClient.email.trim() || undefined,
        });
        clientId = c.id;
      }
      const proj = await createProject.mutateAsync({
        name: project.name.trim(),
        address: project.address.trim(),
        clientId: clientId ?? undefined,
      });
      const estimate = await estimatesApi.createForProject(proj.id, {});
      navigate(routes.estimate(estimate.id), { replace: true });
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
            onClick={() => navigate(routes.home)}
            aria-label={t('common.back')}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-primary">{t('estimate.newTitle')}</h1>
        </div>

        {/* Client */}
        <section className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">{t('estimate.client')}</h2>
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'existing' ? 'new' : 'existing'));
                setSelectedId(null);
              }}
              className="text-[13px] font-semibold text-brand"
            >
              {mode === 'existing' ? t('estimate.newClient') : t('estimate.chooseExisting')}
            </button>
          </div>

          {mode === 'new' ? (
            <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
              <FormField label={t('common.fullName')} htmlFor="nc-name" required>
                <Input
                  id="nc-name"
                  value={newClient.fullName}
                  onChange={(e) => setNewClient((s) => ({ ...s, fullName: e.target.value }))}
                />
              </FormField>
              <FormField label={t('common.phone')} htmlFor="nc-phone" required>
                <Input
                  id="nc-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder={t('auth.phonePlaceholder')}
                  value={newClient.phone}
                  onChange={(e) => setNewClient((s) => ({ ...s, phone: e.target.value }))}
                />
              </FormField>
              <FormField label={t('common.email')} htmlFor="nc-email" hint={t('estimate.emailHint')}>
                <Input
                  id="nc-email"
                  type="email"
                  inputMode="email"
                  placeholder="client@example.com"
                  value={newClient.email}
                  onChange={(e) => setNewClient((s) => ({ ...s, email: e.target.value }))}
                />
              </FormField>
            </div>
          ) : (
            <div>
              <Input
                placeholder={t('estimate.searchClient')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-2"
              />
              {clients.isPending ? (
                <div className="flex justify-center py-4 text-brand">
                  <Spinner />
                </div>
              ) : filtered.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border py-4 text-center text-sm text-muted">
                  {t('estimate.noClients')}
                </p>
              ) : (
                <div className="max-h-[34dvh] space-y-1.5 overflow-y-auto">
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border bg-surface px-3.5 py-2.5 text-left transition-colors',
                        selectedId === c.id ? 'border-brand bg-brand-soft' : 'border-border',
                      )}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                        {initials(c.fullName)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-primary">
                          {c.fullName}
                        </span>
                        <span className="block text-xs text-muted">{c.phone}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
          </div>
        </section>

        {atProjectLimit && (
          <UpgradeBanner text={t('limits.objectsHint', { max: limits.data?.maxProjects })} />
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
