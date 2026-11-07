import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SenderSheetHost } from './SenderSheetHost.tsx';
import { isSenderNameRequired, resetSenderReminder, senderGateWouldAsk, senderSheetStore, useSenderGate, type SenderGateResult } from './senderGate.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { authApi } from '@/api/auth.ts';
import { profileApi } from '@/api/profile.ts';
import { aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { me: vi.fn() } }));
vi.mock('@/api/profile.ts', () => ({ profileApi: { updateSender: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const nameless = aUser({ fullName: undefined, phone: undefined, companyName: undefined });

function setup(me = nameless) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}<SenderSheetHost /></QueryClientProvider>
  );
  const gate = renderHook(() => useSenderGate(), { wrapper });
  return { qc, gate };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(true);
  vi.mocked(authApi.me).mockResolvedValue(nameless);
  senderSheetStore.settle(false);
  resetSenderReminder();
});

describe('useSenderGate — «Як вас підписати в документі?» (V190)', () => {
  it('lets a master with a name straight through, opening nothing', async () => {
    const { gate } = setup(aUser({ fullName: 'Іван' }));

    await expect(gate.result.current()).resolves.toBe('ready');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('asks the server before asking him — the name may have been typed on another phone', async () => {
    vi.mocked(authApi.me).mockResolvedValue(aUser({ fullName: 'Іван з планшета' }));
    const { gate } = setup();

    await expect(gate.result.current()).resolves.toBe('ready');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks, refuses a blank name, saves what he typed to the profile, and goes on', async () => {
    vi.mocked(profileApi.updateSender).mockResolvedValue(aUser({ fullName: 'Іван Петренко' }));
    const { gate } = setup();
    const onAsk = vi.fn();

    let outcome: Promise<SenderGateResult> = Promise.resolve('cancelled');
    act(() => { outcome = gate.result.current(onAsk); });
    const dialog = await screen.findByRole('dialog', { name: 'Як вас підписати в документі?' });
    expect(onAsk).toHaveBeenCalledOnce();
    expect(within(dialog).getByText(/Збережемо в профілі — більше не питатимемо/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти і продовжити' }));
    expect(await within(dialog).findByText("Введіть ім'я та прізвище")).toBeTruthy();
    expect(profileApi.updateSender).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Ім'я та прізвище/), { target: { value: '  Іван Петренко ' } });
    fireEvent.change(within(dialog).getByLabelText(/Телефон/), { target: { value: ' +380501112233 ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти і продовжити' }));

    await expect(outcome).resolves.toBe('saved');
    expect(profileApi.updateSender).toHaveBeenCalledWith({
      fullName: 'Іван Петренко', phone: '+380501112233', companyName: '',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says «cancelled» when he closes the sheet, and sends nothing', async () => {
    const { gate } = setup();

    let outcome: Promise<SenderGateResult> = Promise.resolve('ready');
    act(() => { outcome = gate.result.current(); });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скасувати' }));

    await expect(outcome).resolves.toBe('cancelled');
    expect(profileApi.updateSender).not.toHaveBeenCalled();
  });

  it('previews the header the client reads — the company, else the name', async () => {
    const { gate } = setup();
    act(() => { void gate.result.current(); });
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Ім'я та прізвище/), { target: { value: 'Іван' } });
    expect(within(dialog).getByText('Іван', { selector: 'p' })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Назва компанії/), { target: { value: 'ФОП Іван' } });
    expect(within(dialog).getByText('ФОП Іван', { selector: 'p' })).toBeTruthy();
  });

  it('two taps share one sheet', async () => {
    const { gate } = setup();
    act(() => { void gate.result.current(); void gate.result.current(); });
    await screen.findByRole('dialog');

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('useSenderGate — the light reminder for an empty company or phone', () => {
  const nameOnly = aUser({ fullName: 'Іван', companyName: undefined, phone: undefined });

  it('reminds once per session, and «Пропустити» lets the document go as it is', async () => {
    const { gate } = setup(nameOnly);
    const onAsk = vi.fn();

    let outcome: Promise<SenderGateResult> = Promise.resolve('ready');
    act(() => { outcome = gate.result.current(onAsk); });
    const dialog = await screen.findByRole('dialog', { name: 'Додати назву компанії і телефон?' });
    expect(onAsk).toHaveBeenCalledOnce();
    expect(within(dialog).getByText(/так буде і в наступних кошторисах/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Пропустити' }));

    await expect(outcome).resolves.toBe('skipped');
    expect(profileApi.updateSender).not.toHaveBeenCalled();
    // The second document in the same session is not asked again.
    await expect(gate.result.current()).resolves.toBe('ready');
    expect(senderGateWouldAsk(nameOnly)).toBe(false);
  });

  it('«Зберегти в профілі» saves the company and phone with the name', async () => {
    vi.mocked(profileApi.updateSender).mockResolvedValue(aUser({ fullName: 'Іван', companyName: 'ФОП Іван' }));
    const { gate } = setup(nameOnly);

    let outcome: Promise<SenderGateResult> = Promise.resolve('ready');
    act(() => { outcome = gate.result.current(); });
    const dialog = await screen.findByRole('dialog', { name: 'Додати назву компанії і телефон?' });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Ім'я та прізвище/).value).toBe('Іван');
    fireEvent.change(within(dialog).getByLabelText(/Назва компанії/), { target: { value: 'ФОП Іван' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти в профілі' }));

    await expect(outcome).resolves.toBe('saved');
    expect(profileApi.updateSender).toHaveBeenCalledWith({ fullName: 'Іван', phone: '', companyName: 'ФОП Іван' });
  });

  it('asks nothing of a master whose name, company and phone are all there', async () => {
    const { gate } = setup(aUser());
    await expect(gate.result.current()).resolves.toBe('ready');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('isSenderNameRequired', () => {
  it('recognises the backend refusal, and nothing else', () => {
    const refusal = { isAxiosError: true, response: { status: 403, data: { status: 403, message: 'x', code: 'SENDER_NAME_REQUIRED' } } };
    const pro = { isAxiosError: true, response: { status: 403, data: { status: 403, message: 'x', code: 'FEATURE_NOT_AVAILABLE' } } };
    expect(isSenderNameRequired(refusal)).toBe(true);
    expect(isSenderNameRequired(pro)).toBe(false);
  });

  it('is rendered nowhere until asked', () => {
    render(<QueryClientProvider client={new QueryClient()}><SenderSheetHost /></QueryClientProvider>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
