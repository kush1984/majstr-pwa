import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppReviewSheet, StarPicker } from './AppReviewSheet.tsx';
import { useAppReviewPrompt, useDismissAppReviewPrompt } from './useAppReview.ts';

/**
 * «Як вам Majstr?» on the home screen (V218) — a quiet card, not a pop-up, shown only when the server
 * says so: after a success, never in the first week, then no sooner than every 90 days. One tap on a
 * star opens the sheet with it picked; «Не зараз» puts it away for those 90 days.
 */
export function AppReviewPromptCard() {
  const { t } = useTranslation();
  const prompt = useAppReviewPrompt();
  const dismiss = useDismissAppReviewPrompt();
  const [picked, setPicked] = useState(0);

  if (!prompt.data?.ask && picked === 0) return null;

  return (
    <>
      {prompt.data?.ask && (
        <section className="mb-5 rounded-card border border-border bg-surface p-4" aria-labelledby="app-review-ask">
          <div className="flex items-start justify-between gap-3">
            <h2 id="app-review-ask" className="text-[15px] font-bold text-primary">{t('appReview.askTitle')}</h2>
            <button
              type="button"
              onClick={() => dismiss.mutate()}
              className="-mr-1 -mt-1 min-h-[36px] px-1 text-sm font-semibold text-muted"
            >
              {t('appReview.notNow')}
            </button>
          </div>
          <p className="mt-0.5 text-sm text-muted">{t('appReview.askText')}</p>
          <div className="mt-2">
            <StarPicker value={0} onChange={setPicked} size="md" />
          </div>
        </section>
      )}
      <AppReviewSheet open={picked > 0} initialRating={picked} source="PROMPT" onClose={() => setPicked(0)} />
    </>
  );
}
