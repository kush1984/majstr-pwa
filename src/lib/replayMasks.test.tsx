import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { Modal } from '@/components/Modal.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import type { ProjectResponse } from '@/api/types.ts';

vi.mock('@/api/messageLink.ts', () => ({ messageLinkApi: { state: vi.fn(), revoke: vi.fn() } }));
vi.mock('@/api/projects.ts', () => ({ projectsApi: { setStatus: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/**
 * What session replay may never record (reviews P-07, P-25, P-44).
 *
 * <p>PostHog masks every input and every `.ph-mask` container (`lib/posthog.ts`), which makes the
 * class the whole mechanism — and a container that simply does not carry it fails SILENTLY: the
 * recording looks fine, and the data it should not hold is in it. Nothing else in the app can catch
 * that, so the surfaces that show somebody else's personal data or the master's money assert the
 * class here, on the rendered DOM.</p>
 *
 * <p>The `Modal` case is the one that was most wrong and least visible: it renders through
 * `createPortal` into `document.body`, so it sits OUTSIDE whatever mask its caller wrapped the
 * screen in. Payment sheets, receipt forms and every confirm dialog were recorded in full while the
 * screen behind them was redacted.</p>
 */
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const project: ProjectResponse = {
  id: 'p1',
  name: 'Квартира на Зубрівській',
  address: 'вул. Зубрівська 12, кв. 4',
  status: 'DRAFT',
  stage: 'IN_PROGRESS',
  description: null,
  clientId: null,
  clientFullName: 'Олена Петренко',
  latestEstimateTotal: 61070,
  estimateStatus: null,
  unreadQuestions: 0,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};

/** The nearest `.ph-mask` ancestor of the element that renders `text`, or null. */
function maskedAncestorOf(text: string | RegExp): HTMLElement | null {
  return screen.getByText(text).closest('.ph-mask');
}

describe('session-replay masks', () => {
  it('masks a modal’s content, which a portal puts outside every screen mask', () => {
    render(
      <Modal open title="Отримати платіж" onClose={vi.fn()}>
        <p>20 000 ₴</p>
      </Modal>,
      { wrapper },
    );

    expect(maskedAncestorOf('20 000 ₴')).not.toBeNull();
  });

  it('lets a modal opt OUT explicitly, never by omission', () => {
    // The default is «masked» on purpose: a sheet added next year is private unless somebody
    // decides otherwise, which is the right direction for a default about personal data to fail in.
    render(
      <Modal open mask={false} title="Довідка" onClose={vi.fn()}>
        <p>Що таке акт?</p>
      </Modal>,
      { wrapper },
    );

    expect(maskedAncestorOf('Що таке акт?')).toBeNull();
  });

  it('masks the object card — a street, an address and the client’s own name', () => {
    render(<ProjectCard project={project} />, { wrapper });

    expect(maskedAncestorOf('Квартира на Зубрівській')).not.toBeNull();
    expect(maskedAncestorOf(/Зубрівська 12/)).not.toBeNull();
    expect(maskedAncestorOf('Олена Петренко')).not.toBeNull();
  });
});
