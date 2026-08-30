import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { cn } from '@/lib/cn.ts';
import { initials } from '@/lib/format.ts';
import { useClients } from '@/features/clients/useClients.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { ClientDataAckModal } from '@/features/legal/ConsentModals.tsx';
import type { ClientRequest, ClientResponse } from '@/api/types.ts';

export type ClientMode = 'none' | 'existing' | 'new';

/** A client choice in progress: none (skip), an existing id, or new fields. */
export interface ClientDraft {
  mode: ClientMode;
  selectedId: string | null;
  newClient: { fullName: string; phone: string; email: string };
}

export const emptyClientDraft: ClientDraft = {
  mode: 'none',
  selectedId: null,
  newClient: { fullName: '', phone: '', email: '' },
};

/** Validation: returns an i18n key to toast, or null when the draft is usable
 *  ('none' is always valid — the client is optional). */
export function clientDraftError(d: ClientDraft): string | null {
  if (d.mode === 'new' && (!d.newClient.fullName.trim() || !d.newClient.phone.trim())) {
    return 'estimate.enterClientNamePhone';
  }
  if (d.mode === 'existing' && !d.selectedId) return 'estimate.chooseOrCreateClient';
  return null;
}

/** Resolve a draft to a clientId, creating the client if it's new. Returns
 *  undefined for "none". Caller must have validated with clientDraftError first. */
export async function resolveClientId(
  d: ClientDraft,
  createClient: { mutateAsync: (req: ClientRequest) => Promise<ClientResponse> },
): Promise<string | undefined> {
  if (d.mode === 'existing') return d.selectedId ?? undefined;
  if (d.mode === 'new') {
    const c = await createClient.mutateAsync({
      fullName: d.newClient.fullName.trim(),
      phone: d.newClient.phone.trim(),
      email: d.newClient.email.trim() || undefined,
    });
    return c.id;
  }
  return undefined;
}

/**
 * Controlled client chooser shared by the "object + estimate" flow, the
 * "object only" flow, and the share-sheet "add client" prompt. Segmented:
 * Без клієнта / Наявний / Новий. `allowNone` hides the skip option where a
 * client is mandatory (the share prompt).
 */
export function ClientPicker({
  value,
  onChange,
  allowNone = true,
}: {
  value: ClientDraft;
  onChange: (d: ClientDraft) => void;
  allowNone?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const clients = useClients();
  const { data: me } = useMe();
  const [search, setSearch] = useState('');
  // First time the master enters NEW client data, confirm they're responsible
  // for it (controller/operator distinction). Shown once (acknowledgedClientDataAt).
  const [ackOpen, setAckOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = clients.data ?? [];
    return needle ? list.filter((c) => c.fullName.toLowerCase().includes(needle)) : list;
  }, [clients.data, search]);

  const modes: ClientMode[] = allowNone ? ['none', 'existing', 'new'] : ['existing', 'new'];
  const switchTo = (m: ClientMode) =>
    onChange({ ...value, mode: m, selectedId: m === 'existing' ? value.selectedId : null });
  const setMode = (m: ClientMode) => {
    // Gate the "Новий" tab on the one-time client-data acknowledgement.
    if (m === 'new' && me && me.acknowledgedClientDataAt == null) {
      setAckOpen(true);
      return;
    }
    switchTo(m);
  };

  // Session-replay masking: everything inside is redacted in the recording (lib/posthog.ts).
  return (
    <div className="ph-mask">
      <div className="mb-3 flex gap-1 rounded-xl bg-surface-sunken p-1">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
              value.mode === m ? 'bg-surface text-primary shadow-card' : 'text-muted',
            )}
          >
            {t('clientPicker.' + m)}
          </button>
        ))}
      </div>

      {value.mode === 'none' ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted">
          {t('clientPicker.noneHint')}
        </p>
      ) : value.mode === 'new' ? (
        <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
          <FormField label={t('common.fullName')} htmlFor="cp-name" required>
            <Input
              id="cp-name"
              value={value.newClient.fullName}
              onChange={(e) =>
                onChange({ ...value, newClient: { ...value.newClient, fullName: e.target.value } })
              }
            />
          </FormField>
          <FormField label={t('common.phone')} htmlFor="cp-phone" required>
            <Input
              id="cp-phone"
              type="tel"
              inputMode="tel"
              placeholder={t('auth.phonePlaceholder')}
              value={value.newClient.phone}
              onChange={(e) =>
                onChange({ ...value, newClient: { ...value.newClient, phone: e.target.value } })
              }
            />
          </FormField>
          <FormField label={t('common.email')} htmlFor="cp-email" hint={t('estimate.emailHint')}>
            <Input
              id="cp-email"
              type="email"
              inputMode="email"
              placeholder="client@example.com"
              value={value.newClient.email}
              onChange={(e) =>
                onChange({ ...value, newClient: { ...value.newClient, email: e.target.value } })
              }
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
          ) : !online && (clients.data?.length ?? 0) === 0 ? (
            // "Немає клієнтів" would deny clients the master really has — they are just not here.
            <OfflineNotCached compact what={t('offline.dataClients')} />
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
                  onClick={() => onChange({ ...value, selectedId: c.id })}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border bg-surface px-3.5 py-2.5 text-left transition-colors',
                    value.selectedId === c.id ? 'border-brand bg-brand-soft' : 'border-border',
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

      {ackOpen && (
        <ClientDataAckModal
          onResolved={() => {
            setAckOpen(false);
            switchTo('new');
          }}
          onCancel={() => setAckOpen(false)}
        />
      )}
    </div>
  );
}
