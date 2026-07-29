import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { ChatLinkRowButton } from './ChatLinkRowButton.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { messageLinkApi } from '@/api/messageLink.ts';
import { toast } from '@/hooks/useToast.ts';
import type { ProjectResponse } from '@/api/types.ts';

/**
 * The chat link, as reached from a row of the object list.
 *
 * <p>The link is copied, never shown, so the toast is the only thing the master can judge — which makes
 * "the clipboard refused but we said скопійовано" the failure worth pinning. The other is that the ⋯
 * must not open the object: the card underneath it is a navigation button.</p>
 */
vi.mock('@/api/messageLink.ts', () => ({
  messageLinkApi: { state: vi.fn(), revoke: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function setClipboard(impl: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: impl ? { writeText: vi.fn(impl) } : undefined,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setClipboard(() => Promise.resolve());
  vi.mocked(messageLinkApi.state).mockResolvedValue({
    url: 'https://majstr.pro/message/index.html?m=tok',
  });
});

const openSheet = async () => {
  render(
    <MemoryRouter>
      <ChatLinkRowButton projectId="p1" projectName="Квартира" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Квартира/ }));
  return screen.findByRole('button', { name: 'Скопіювати посилання' });
};

describe('ChatLinkRowButton', () => {
  it('mints the link and copies it', async () => {
    fireEvent.click(await openSheet());

    await waitFor(() => expect(messageLinkApi.state).toHaveBeenCalledWith('p1'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://majstr.pro/message/index.html?m=tok',
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('does not claim success when the clipboard refuses, and shows the link instead', async () => {
    // Safari's focus rules and insecure contexts both land here while the link itself was minted fine.
    setClipboard(() => Promise.reject(new Error('denied')));

    fireEvent.click(await openSheet());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    // The URL goes in the message so the master can still copy it by hand.
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('m=tok');
  });

  it('offers no revoke from a list row', async () => {
    // Deliberate: from a row the master wants the link, and a destructive action beside it is a mis-tap
    // waiting to happen. Revoking lives on the object's own screen.
    await openSheet();

    expect(screen.queryByRole('button', { name: 'Відкликати посилання' })).toBeNull();
  });

  it('the ⋯ on a list card opens the sheet without opening the object', async () => {
    // What makes this work is structural: the ⋯ is a SIBLING of the card's navigation button, not a
    // child of it. Nest it and every tap would navigate too — so the DOM relationship is asserted here
    // rather than left to a stopPropagation call that would be invisible if lost.
    const project = {
      id: 'p1', name: 'Квартира', address: 'вул. 1', status: 'IN_PROGRESS',
      clientFullName: null, clientId: null, description: null,
      unreadQuestions: 0, latestEstimateTotal: null, estimateStatus: null,
      createdAt: '2026-07-20T10:00:00Z',
    } as unknown as ProjectResponse;
    render(<MemoryRouter><ProjectCard project={project} /></MemoryRouter>);

    const kebab = screen.getByRole('button', { name: /Посилання на чат/ });
    expect(screen.getByText('Квартира').closest('button')).not.toBe(kebab);

    fireEvent.click(kebab);

    expect(await screen.findByRole('button', { name: 'Скопіювати посилання' })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
