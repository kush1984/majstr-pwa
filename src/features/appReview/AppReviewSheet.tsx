import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import { useSubmitAppReview } from './useAppReview.ts';

/**
 * «Оцінити Majstr» (V218): stars, a few words, and — only at 4–5 stars — his consent to show it on
 * majstr.pro. A low rating asks what to fix instead: it reaches us, never the landing page.
 */
export function AppReviewSheet({
  open,
  initialRating = 0,
  source,
  onClose,
}: {
  open: boolean;
  /** Pre-picked when he tapped a star on the home-screen card. */
  initialRating?: number;
  source: 'PROFILE' | 'PROMPT';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const submit = useSubmitAppReview();
  const [rating, setRating] = useState(initialRating);
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(true);

  useEffect(() => {
    if (open) {
      setRating(initialRating);
      setText('');
      setConsent(true);
    }
  }, [open, initialRating]);

  const happy = rating >= 4;
  const onSend = () => {
    if (rating === 0) return;
    submit.mutate(
      { rating, text: text.trim() || null, source, publishConsent: happy && consent },
      {
        onSuccess: () => {
          toast.success(t(happy && consent ? 'appReview.thanksPublish' : 'appReview.thanks'));
          onClose();
        },
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t('appReview.title')}>
      <StarPicker value={rating} onChange={setRating} />
      {rating > 0 && (
        <>
          <label htmlFor="app-review-text" className="mt-4 block text-sm font-semibold text-primary">
            {t(happy ? 'appReview.askGood' : 'appReview.askFix')}
          </label>
          <textarea
            id="app-review-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={t(happy ? 'appReview.placeholderGood' : 'appReview.placeholderFix')}
            className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          {happy && (
            <div className="mt-2">
              <Checkbox label={t('appReview.consent')} checked={consent} onChange={() => setConsent((v) => !v)} />
            </div>
          )}
          <Button fullWidth className="mt-4 min-h-[48px]" loading={submit.isPending} onClick={onSend}>
            {t('appReview.send')}
          </Button>
        </>
      )}
    </Modal>
  );
}

/** Five stars, each a 44 px target; the chosen one and those before it are filled. */
export function StarPicker({ value, onChange, size = 'lg' }: {
  value: number;
  onChange: (rating: number) => void;
  size?: 'lg' | 'md';
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center gap-1" role="radiogroup" aria-label={t('appReview.starsLabel')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t('appReview.star', { count: n })}
          onClick={() => onChange(n)}
          className={cn(
            'flex min-h-[44px] min-w-[44px] items-center justify-center leading-none transition-colors',
            size === 'lg' ? 'text-[34px]' : 'text-[28px]',
            n <= value ? 'text-amber' : 'text-gray-300',
          )}
        >
          ★
        </button>
      ))}
    </div>
  );
}
