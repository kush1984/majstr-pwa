import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useClient, useUpdateClient } from './useClients.ts';

interface Form {
  fullName: string;
  phone: string;
  email: string;
  address: string;
}

/**
 * Edit an existing client (Fix F #13). Loads the client when opened, pre-fills
 * the form, and PUTs all fields with the same validation as creation. On save
 * it also invalidates ['projects'] so a renamed client updates on the cards.
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
  const [form, setForm] = useState<Form>({ fullName: '', phone: '', email: '', address: '' });
  const [errors, setErrors] = useState<{ fullName?: boolean; phone?: boolean; email?: boolean }>({});

  // Re-fill whenever the modal opens with fresh client data.
  useEffect(() => {
    if (open && client.data) {
      setForm({
        fullName: client.data.fullName,
        phone: client.data.phone,
        email: client.data.email ?? '',
        address: client.data.address ?? '',
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

    try {
      await updateClient.mutateAsync({
        id: clientId,
        req: {
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          address: form.address.trim() || undefined,
          email: form.email.trim() || undefined,
        },
      });
      // The client's name shows on project cards / detail — refresh those too.
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(t('clients.updated'));
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('clients.editTitle')}>
      {client.isPending ? (
        <p className="py-4 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <div className="space-y-3">
          <Field label={t('common.fullName')}>
            <Input
              value={form.fullName}
              onChange={set('fullName')}
              invalid={errors.fullName}
              placeholder={t('clients.namePlaceholder')}
            />
          </Field>
          <Field label={t('common.phone')}>
            <Input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              invalid={errors.phone}
              placeholder={t('clients.phonePlaceholder')}
            />
          </Field>
          <Field label={t('clients.emailOptional')}>
            <Input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={set('email')}
              invalid={errors.email}
              placeholder="client@example.com"
            />
          </Field>
          <Field label={t('clients.addressOptional')}>
            <Input value={form.address} onChange={set('address')} placeholder={t('clients.addressPlaceholder')} />
          </Field>
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
