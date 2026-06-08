import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '@/lib/i18n.ts';
import { captureException } from '@/lib/sentry.ts';

interface Props {
  children: ReactNode;
  /**
   * Custom fallback. Receives a `reset` fn that clears the boundary's error
   * state so the subtree can try to re-render (useful for surface-specific
   * screens, e.g. the client portal). Defaults to {@link DefaultFallback}.
   */
  fallback?: (args: { reset: () => void; error: Error }) => ReactNode;
  /** Label attached to the Sentry report so we know which boundary tripped. */
  name?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it so a crashing component shows a
 * friendly screen instead of a blank white page, and reports the error to
 * Sentry. One global instance wraps the whole app (see `main.tsx`); nest more
 * around independently-recoverable surfaces if needed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // First responder: we hear about the crash before the user reports it.
    captureException(error, {
      boundary: this.props.name ?? 'global',
      componentStack: info.componentStack,
    });
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return this.props.fallback
        ? this.props.fallback({ reset: this.reset, error })
        : <DefaultFallback />;
    }
    return this.props.children;
  }
}

/**
 * Friendly full-screen fallback. Uses `i18n.t` directly (not the `useTranslation`
 * hook) so it has no React-context dependencies — it must render even when the
 * app tree below is broken. Hardcoded Ukrainian defaults guarantee a readable
 * screen even if i18n itself failed to load.
 */
function DefaultFallback() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <div className="text-5xl">😕</div>
      <h1 className="text-xl font-bold text-primary">
        {i18n.t('errors.boundaryTitle', { defaultValue: 'Щось пішло не так' })}
      </h1>
      <p className="max-w-sm text-sm text-muted">
        {i18n.t('errors.boundaryText', {
          defaultValue:
            'Сталася неочікувана помилка. Спробуйте оновити сторінку.',
        })}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white"
      >
        {i18n.t('errors.boundaryReload', { defaultValue: 'Оновити сторінку' })}
      </button>
    </div>
  );
}
