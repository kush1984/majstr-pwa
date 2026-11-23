import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { AppReviewPromptCard } from './AppReviewPromptCard.tsx';
import { AppReviewSheet } from './AppReviewSheet.tsx';
import { appReviewsApi } from '@/api/appReviews.ts';

/**
 * Masters rate Majstr (V218): the home screen asks only when the server says so, a star opens the
 * sheet, a high rating offers to be shown on majstr.pro, a low one asks what to fix and is never shown.
 */
vi.mock('@/api/appReviews.ts', () => ({
  appReviewsApi: { prompt: vi.fn(), dismissPrompt: vi.fn(), submit: vi.fn(), published: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function withQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appReviewsApi.submit).mockResolvedValue(undefined);
  vi.mocked(appReviewsApi.dismissPrompt).mockResolvedValue(undefined);
});

describe('AppReviewPromptCard', () => {
  it('shows nothing when the server says not now', async () => {
    vi.mocked(appReviewsApi.prompt).mockResolvedValue({ ask: false });
    const { container } = withQuery(<AppReviewPromptCard />);

    await waitFor(() => expect(appReviewsApi.prompt).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('a tapped star opens the sheet with it picked; sending puts the card away', async () => {
    vi.mocked(appReviewsApi.prompt).mockResolvedValue({ ask: true });
    withQuery(<AppReviewPromptCard />);

    fireEvent.click(await screen.findByRole('radio', { name: '5 зірок' }));
    expect(await screen.findByText('Що вам подобається найбільше?')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Кошторис за 10 хвилин ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(appReviewsApi.submit).toHaveBeenCalledWith({
      rating: 5, text: 'Кошторис за 10 хвилин', source: 'PROMPT', publishConsent: true,
    }));
    await waitFor(() => expect(screen.queryByText('Як вам Majstr?')).toBeNull());
  });

  it('«Не зараз» tells the server and hides the card', async () => {
    vi.mocked(appReviewsApi.prompt).mockResolvedValue({ ask: true });
    withQuery(<AppReviewPromptCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Не зараз' }));

    await waitFor(() => expect(appReviewsApi.dismissPrompt).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Як вам Majstr?')).toBeNull());
  });
});

describe('AppReviewSheet', () => {
  it('a low rating asks what to fix and offers no consent to be shown', async () => {
    withQuery(<AppReviewSheet open source="PROFILE" onClose={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: '2 зірки' }));
    expect(screen.getByText('Що нам поправити?')).toBeTruthy();
    expect(screen.queryByText(/Можна показати мій відгук/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(appReviewsApi.submit).toHaveBeenCalledWith({
      rating: 2, text: null, source: 'PROFILE', publishConsent: false,
    }));
  });

  it('a high rating can be kept private by unticking the consent', async () => {
    withQuery(<AppReviewSheet open source="PROFILE" onClose={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: '4 зірки' }));
    fireEvent.click(screen.getByText(/Можна показати мій відгук/));
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(appReviewsApi.submit).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 4, publishConsent: false })));
  });
});
