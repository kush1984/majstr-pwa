import { Modal } from './Modal.tsx';
import { Button } from './Button.tsx';

/** Confirmation before destructive actions (delete). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Видалити',
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-5 text-sm text-muted">{message}</p>
      <div className="flex gap-2">
        <Button variant="secondary" fullWidth onClick={onClose}>
          Скасувати
        </Button>
        <Button
          fullWidth
          loading={loading}
          onClick={onConfirm}
          className="bg-danger text-white hover:bg-danger focus-visible:ring-danger"
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
