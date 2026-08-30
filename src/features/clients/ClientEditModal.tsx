import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { clientTaxIdWarning } from '@/lib/requisites.ts';
import { useClient, useUpdateClient } from './useClients.ts';
import type { ClientType } from '@/api/types.ts';

interface Form {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  clientType: ClientType;
  taxId: string;
  legalName: string;
  legalAddress: string;
  signatoryTitle: string;
  signatoryName: string;
}

const CLIENT_TYPES: ClientType[] = ['PERSON', 'FOP', 'COMPANY'];

/**
 * Edit an existing client (Fix F #13). Loads the client when opened, pre-fills the form, and PUTs
 * all fields with the same validation as creation.
 *
 * <p>The type switch (acts iteration) decides which requisites show: a PERSON needs only a name,
 * a ФОП/Компанія carry the legal details an act/PDF prints. Requisite length checks are WARNINGS
 * (yellow), never blocking — a master can save a half-filled record. On save it also invalidates
 * ['projects'] so a renamed client updates on the cards.</p>
 */
export function ClientEditModal({
  open,
  onClose,
  clientId,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const client = useClient(clientId, open && Boolean(clientId));
  const updateClient = useUpdateClient();
  const [form, setForm] = useState<Form>({
    fullName: '', phone: '', email: '', address: '',
    clientType: 'PERSON', taxId: '', legalName: '', legalAddress: '', signatoryTitle: '', signatoryName: '',
  });
  const [errors, setErrors] = useState<{ fullName?: boolean; phone?: boolean; email?: boolean }>({});

  // Re-fill whenever the modal opens with fresh client data.
  useEffect(() => {
    if (open && client.data) {
      setForm({
        fullName: client.data.fullName,
        phone: client.data.phone,
        email: client.data.email ?? '',
        address: client.data.address ?? '',
        clientType: client.data.clientType,
        taxId: client.data.taxId ?? '',
        legalName: client.data.legalName ?? '',
        legalAddress: client.data.legalAddress ?? '',
        signatoryTitle: client.data.signatoryTitle ?? '',
        signatoryName: client.data.signatoryName ?? '',
      });
      setErrors({});
    }
  }, [open, client.data]);

  const set =
    (key: keyof Form) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSave = async () => {
    const next = {
      fullName: !form.fullName.trim(),
      phone: !form.phone.trim(),
      email: form.email.trim() !== '' && !form.email.includes('@'),
    };
    setErrors(next);
    if (next.fullName || next.phone || next.email) return;

    const hasRequisites = form.clientType !== 'PERSON';
    try {
      await updateClient.mutateAsync({
        id: clientId,
        req: {
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          address: form.address.trim() || undefined,
          email: form.email.trim() || undefined,
          clientType: form.clientType,
          // A PERSON carries no legal details; blank strings clear them server-side.
          taxId: hasRequisites ? form.taxId.trim() : '',
          legalName: hasRequisites ? form.legalName.trim() : '',
          legalAddress: hasRequisites ? form.legalAddress.trim() : '',
          signatoryTitle: form.clientType === 'COMPANY' ? form.signatoryTitle.trim() : '',
          signatoryName: form.clientType === 'COMPANY' ? form.signatoryName.trim() : '',
        },
      });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(t('clients.updated'));
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const taxWarn = clientTaxIdWarning(form.taxId, form.clientType);

  // The ph-mask below redacts name / phone / email in session replay (lib/posthog.ts).
  return (
    <Modal open={open} onClose={onClose} title={t('clients.editTitle')}>
      {client.isPending ? (
        <p className="py-4 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <div className="ph-mask space-y-3">
          <Field label={t('common.fullName')}>
            <Input value={form.fullName} onChange={set('fullName')} invalid={errors.fullName}
              placeholder={t('clients.namePlaceholder')} />
          </Field>
          <Field label={t('common.phone')}>
            <Input type="tel" inputMode="tel" value={form.phone} onChange={set('phone')}
              invalid={errors.phone} placeholder={t('clients.phonePlaceholder')} />
          </Field>
          <Field label={t('clients.emailOptional')}>
            <Input type="email" inputMode="email" value={form.email} onChange={set('email')}
              invalid={errors.email} placeholder="client@example.com" />
          </Field>
          <Field label={t('clients.addressOptional')}>
            <Input value={form.address} onChange={set('address')} placeholder={t('clients.addressPlaceholder')} />
          </Field>

          {/* Type switch (acts iteration) — decides which requisites appear below. */}
          <Field label={t('clients.type.label')}>
            <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
              {CLIENT_TYPES.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, clientType: ct }))}
                  className={
                    'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ' +
                    (form.clientType === ct ? 'bg-white text-brand shadow-sm' : 'text-muted')
                  }
                >
                  {t('clients.type.' + ct)}
                </button>
              ))}
            </div>
          </Field>

          {form.clientType !== 'PERSON' && (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
              <Field label={t('clients.req.legalName')}>
                <Input value={form.legalName} onChange={set('legalName')} />
              </Field>
              <Field label={form.clientType === 'COMPANY' ? t('clients.req.edrpou') : t('clients.req.rnokpp')}>
                <Input inputMode="numeric" value={form.taxId} onChange={set('taxId')} invalid={Boolean(taxWarn)} />
                {taxWarn && <span className="mt-1 block text-xs text-amber-600">{t(taxWarn)}</span>}
              </Field>
              <Field label={t('clients.req.legalAddress')}>
                <Input value={form.legalAddress} onChange={set('legalAddress')} />
              </Field>
              {form.clientType === 'COMPANY' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('clients.req.signatoryTitle')}>
                    <Input value={form.signatoryTitle} onChange={set('signatoryTitle')} placeholder={t('clients.req.signatoryTitlePlaceholder')} />
                  </Field>
                  <Field label={t('clients.req.signatoryName')}>
                    <Input value={form.signatoryName} onChange={set('signatoryName')} />
                  </Field>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button fullWidth loading={updateClient.isPending} onClick={onSave}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
