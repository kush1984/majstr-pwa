import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectDetailPage } from './ProjectDetailPage.tsx';
import { projectsApi } from '@/api/projects.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { EstimateSummary, ProjectResponse, UserResponse } from '@/api/types.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { aUser } from '@/test/factories.ts';
import { track } from '@/lib/posthog.ts';

/**
 * Object-first: the object is where an estimate is made. Right after «Створити об'єкт» the page
 * opens with «Що далі?» up — once, never on an ordinary visit; the «＋» is the open tab's action;
 * what the FAB menu used to carry is in the header's ⋮.
 */
vi.mock('@/api/projects.ts', () => ({ projectsApi: { get: vi.fn(), list: vi.fn(), update: vi.fn(), remove: vi.fn() } }));
vi.mock('@/api/estimates.ts', () => ({ estimatesApi: { listForProject: vi.fn(), createForProject: vi.fn() } }));
vi.mock('@/api/notes.ts', () => ({ notesApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/api/plan.ts', () => ({ planApi: { limits: vi.fn().mockResolvedValue({ maxEstimatesPerProject: null }) } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/posthog.ts', () => ({ track: vi.fn() }));
// The tab sections and sheets are covered on their own; here they would only drag in their APIs.
vi.mock('@/features/messages/MessagesSection.tsx', () => ({ MessagesSection: () => null }));
vi.mock('@/features/messages/ChatLinkSheet.tsx', () => ({ ChatLinkSheet: () => null }));
vi.mock('@/features/shopping/ShoppingObjectRow.tsx', () => ({ ShoppingObjectRow: () => null }));
vi.mock('@/features/notes/NotesSheet.tsx', () => ({
  NotesSheet: ({ open }: { open: boolean }) => (open ? <p>notes-sheet</p> : null),
}));
vi.mock('@/features/projects/SharePortalSheet.tsx', () => ({ SharePortalSheet: () => null }));
vi.mock('@/features/estimate/TemplatePickerSheet.tsx', () => ({
  TemplatePickerSheet: ({ open }: { open: boolean }) => (open ? <p>template-picker</p> : null),
}));
vi.mock('@/features/estimate/ConsolidateSheet.tsx', () => ({ ConsolidateSheet: () => null }));
vi.mock('@/features/measurements/MeasurementsSection.tsx', () => ({ MeasurementsSection: () => null }));
vi.mock('@/features/photos/PhotosSection.tsx', () => ({ PhotosSection: () => null }));
vi.mock('@/features/economy/ObjectEconomySection.tsx', () => ({ ObjectEconomySection: () => null }));
vi.mock('@/features/acts/ActsSection.tsx', () => ({ ActsSection: () => null }));

const project = {
  id: 'p1', name: 'Ванна', address: 'вул. 1', status: 'IN_PROGRESS', stage: 'ASSESSMENT',
  description: null, clientId: null, clientFullName: null, latestEstimateTotal: null, estimateStatus: null,
  unreadQuestions: 0, completedAt: null, createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z',
} as unknown as ProjectResponse;

function renderPage(entry: string | { pathname: string; state?: unknown; search?: string }, me?: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (me) qc.setQueryData(ME_QUERY_KEY, me);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectsApi.get).mockResolvedValue(project);
  vi.mocked(estimatesApi.listForProject).mockResolvedValue([]);
});

describe('ProjectDetailPage — «Що далі?» (object-first)', () => {
  it('opens once, right after the object was created', async () => {
    renderPage({ pathname: '/projects/p1', state: { justCreated: true } });

    expect(await screen.findByText('Обʼєкт створено. Що далі?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Кошторис із шаблону/ }));
    expect(await screen.findByText('template-picker')).toBeTruthy();
  });

  it('back from choosing a trade in the empty picker, the picker reopens by itself', async () => {
    renderPage({ pathname: '/projects/p1', state: { openTemplates: true } });

    expect(await screen.findByText('template-picker')).toBeTruthy();
    expect(screen.queryByText('Обʼєкт створено. Що далі?')).toBeNull();
  });

  it('on FREE, «З файлу або фото» becomes «перенесемо за вас» and opens the owner Telegram chat', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage({ pathname: '/projects/p1', state: { justCreated: true } }, aUser({ plan: 'FREE' }));

    fireEvent.click(await screen.findByRole('button', { name: /Надішліть — перенесемо за вас/ }));

    expect(open).toHaveBeenCalledWith('https://t.me/andriykushka', '_blank', 'noopener');
    expect(track).toHaveBeenCalledWith('concierge_import_tapped');
    expect(screen.queryByRole('button', { name: 'З файлу або фото' })).toBeNull();
    open.mockRestore();
  });

  it('on PRO the import stays the import', async () => {
    renderPage({ pathname: '/projects/p1', state: { justCreated: true } }, aUser({ plan: 'PRO' }));

    expect(await screen.findByRole('button', { name: 'З файлу або фото' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /перенесемо за вас/ })).toBeNull();
  });

  it('the training sample says what it is, and is deleted from its own banner at any stage', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, sample: true });
    vi.mocked(projectsApi.remove).mockResolvedValue(undefined);
    renderPage('/projects/p1');

    expect(await screen.findByText('Це навчальний приклад')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Видалити приклад' }));
    const dialog = await screen.findByRole('dialog', { name: 'Видалити приклад?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Видалити приклад' }));

    await waitFor(() => expect(projectsApi.remove).toHaveBeenCalledWith('p1'));
  });

  it('a real object carries no sample banner', async () => {
    renderPage('/projects/p1');
    await screen.findByText('Ванна');
    expect(screen.queryByTestId('sample-banner')).toBeNull();
  });

  it('does not open on an ordinary visit', async () => {
    renderPage('/projects/p1');

    await screen.findByText('Ванна');
    expect(screen.queryByText('Обʼєкт створено. Що далі?')).toBeNull();
  });

  it('«Пізніше» closes it and leaves the master on the object', async () => {
    renderPage({ pathname: '/projects/p1', state: { justCreated: true } });

    fireEvent.click(await screen.findByRole('button', { name: 'Пізніше' }));

    await waitFor(() => expect(screen.queryByText('Обʼєкт створено. Що далі?')).toBeNull());
    expect(screen.getByText('Ванна')).toBeTruthy();
  });

  it('an empty estimates tab offers «Створити кошторис», which opens the same sheet without the «створено» title', async () => {
    renderPage('/projects/p1');

    fireEvent.click(await screen.findByRole('button', { name: 'Створити кошторис' }));

    expect(await screen.findByRole('button', { name: 'Порожній кошторис' })).toBeTruthy();
    expect(screen.queryByText('Обʼєкт створено. Що далі?')).toBeNull();
  });
});

describe('ProjectDetailPage — every estimate signed', () => {
  // A signed estimate moves to «Економіка»; the tab used to answer «Ще немає кошторисів» about an
  // object that has one.
  it('says where the signed estimate went', async () => {
    vi.mocked(estimatesApi.listForProject).mockResolvedValue([{
      id: 'e1', projectId: 'p1', name: null, status: 'SIGNED', validUntil: null,
      createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z', countInEconomy: true,
      markupPercent: null, duplicatedFromId: null, supersededByEstimateId: null,
    } as unknown as EstimateSummary]);
    renderPage('/projects/p1');

    expect(await screen.findByText('Кошторис підписано')).toBeTruthy();
    expect(screen.queryByText('Ще немає кошторисів')).toBeNull();
    // A further estimate is the «＋»'s, not a second button here.
    expect(screen.getAllByRole('button', { name: 'Новий кошторис' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Відкрити «Економіку»' }));
    await waitFor(() => expect(screen.queryByText('Кошторис підписано')).toBeNull());
  });
});

describe('ProjectDetailPage — the «＋» and the header ⋮ (object-first)', () => {
  it('on «Кошториси» the «＋» is «Новий кошторис», no menu', async () => {
    renderPage('/projects/p1');
    await screen.findByText('Ванна');

    const fab = screen.getByRole('button', { name: 'Новий кошторис' });
    expect(fab.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(fab);
    expect(await screen.findByRole('button', { name: 'Порожній кошторис' })).toBeTruthy();
  });

  it('on another tab the page brings no «＋» of its own — the section does', async () => {
    renderPage({ pathname: '/projects/p1', search: '?tab=measurements' });
    await screen.findByText('Ванна');

    expect(screen.queryByRole('button', { name: 'Новий кошторис' })).toBeNull();
  });

  it('share, chat link, notes and the status moves are in the header ⋮', async () => {
    renderPage('/projects/p1');
    await screen.findByText('Ванна');

    fireEvent.click(screen.getByRole('button', { name: 'Дії з об’єктом' }));

    expect(screen.getByText('Поділитися з клієнтом')).toBeTruthy();
    expect(screen.getByText('Посилання на чат')).toBeTruthy();
    fireEvent.click(screen.getByText('Створити нотатку'));
    expect(await screen.findByText('notes-sheet')).toBeTruthy();
  });

  it('on a closed object the ⋮ keeps the notes and drops what reaches the client', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, status: 'COMPLETED', stage: 'COMPLETED' });
    renderPage('/projects/p1');
    await screen.findByText('Ванна');

    fireEvent.click(screen.getByRole('button', { name: 'Дії з об’єктом' }));

    expect(screen.queryByText('Поділитися з клієнтом')).toBeNull();
    expect(screen.queryByText('Посилання на чат')).toBeNull();
    expect(screen.getByText('Створити нотатку')).toBeTruthy();
  });
});

/** V192: the header shows the name and the address, so the header edits them — the address included,
 *  which an object may now be created without. */
describe('ProjectDetailPage — the header edits what it shows', () => {
  it('offers «Додати адресу» on an object without one, and saves it in place', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, address: undefined });
    vi.mocked(projectsApi.update).mockResolvedValue({ ...project, address: 'вул. Нова 3' });
    renderPage('/projects/p1');

    const cell = await screen.findByRole('button', { name: "Адреса об'єкта" });
    expect(cell.textContent).toBe('Додати адресу');
    fireEvent.click(cell);
    const field = screen.getByRole('textbox', { name: "Адреса об'єкта" });
    fireEvent.change(field, { target: { value: 'вул. Нова 3' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() =>
      expect(projectsApi.update).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Ванна', address: 'вул. Нова 3' })),
    );
  });

  it('renames the object in place, keeping its address', async () => {
    vi.mocked(projectsApi.update).mockResolvedValue({ ...project, name: 'Санвузол' });
    renderPage('/projects/p1');

    fireEvent.click(await screen.findByRole('button', { name: "Назва об'єкта" }));
    const field = screen.getByRole('textbox', { name: "Назва об'єкта" });
    fireEvent.change(field, { target: { value: 'Санвузол' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() =>
      expect(projectsApi.update).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Санвузол', address: 'вул. 1' })),
    );
  });
});
