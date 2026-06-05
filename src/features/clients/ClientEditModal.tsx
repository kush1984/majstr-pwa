import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
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
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Дані клієнта оновлено');
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Редагувати клієнта">
      {client.isPending ? (
        <p className="py-4 text-center text-sm text-muted">Завантаження...</p>
      ) : (
        <div className="space-y-3">
          <Field label="Ім'я та прізвище">
            <Input
              value={form.fullName}
              onChange={set('fullName')}
              invalid={errors.fullName}
              placeholder="Олена Петренко"
            />
          </Field>
          <Field label="Телефон">
            <Input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              invalid={errors.phone}
              placeholder="0XX XXX XX XX"
            />
          </Field>
          <Field label="Email (необов'язково)">
            <Input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={set('email')}
              invalid={errors.email}
              placeholder="client@example.com"
            />
          </Field>
          <Field label="Адреса (необов'язково)">
            <Input value={form.address} onChange={set('address')} placeholder="вул. Соняшна, 12" />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={onClose}>
              Скасувати
            </Button>
            <Button fullWidth loading={updateClient.isPending} onClick={onSave}>
              Зберегти
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
