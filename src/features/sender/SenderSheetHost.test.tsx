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

  it('runs the continue tap of the action INSIDE «Зберегти і продовжити», before the save is awaited', async () => {
    let saveStarted = false;
    vi.mocked(profileApi.updateSender).mockImplementation(() => {
      saveStarted = true;
      return Promise.resolve(aUser({ fullName: 'Іван' }));
    });
    const { gate } = setup();
    const order: string[] = [];
    const onContinueTap = vi.fn(() => { order.push(saveStarted ? 'after-save' : 'in-tap'); return vi.fn(); });

    let outcome: Promise<SenderGateResult> = Promise.resolve('cancelled');
    act(() => { outcome = gate.result.current(undefined, { remind: false, onContinueTap }); });
    const dialog = await screen.findByRole('dialog', { name: 'Як вас підписати в документі?' });
    fireEvent.change(within(dialog).getByLabelText(/Ім'я та прізвище/), { target: { value: 'Іван' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти і продовжити' }));

    await expect(outcome).resolves.toBe('saved');
    // A new tab may only open in a tap: the reservation ran in the click, not after the network.
    expect(order).toEqual(['in-tap']);
  });

  it('undoes the continue tap when the save fails, and keeps the sheet open', async () => {
    vi.mocked(profileApi.updateSender).mockRejectedValue(new Error('offline'));
    const { gate } = setup();
    const undo = vi.fn();
    act(() => { void gate.result.current(undefined, { remind: false, onContinueTap: () => undo }); });
    const dialog = await screen.findByRole('dialog', { name: 'Як вас підписати в документі?' });
    fireEvent.change(within(dialog).getByLabelText(/Ім'я та прізвище/), { target: { value: 'Іван' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти і продовжити' }));

    await waitFor(() => expect(undo).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('never runs the continue tap for a blank name', async () => {
    const { gate } = setup();
    const onContinueTap = vi.fn(() => vi.fn());
    act(() => { void gate.result.current(undefined, { remind: false, onContinueTap }); });
    const dialog = await screen.findByRole('dialog', { name: 'Як вас підписати в документі?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти і продовжити' }));

    expect(await within(dialog).findByText("Введіть ім'я та прізвище")).toBeTruthy();
    expect(onContinueTap).not.toHaveBeenCalled();
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

describe('useSenderGate — the light reminder for an empty phone', () => {
  const noPhone = aUser({ fullName: 'Іван', companyName: undefined, phone: undefined });

  it('reminds once per session, and «Пропустити» lets the document go as it is', async () => {
    const { gate } = setup(noPhone);
    const onAsk = vi.fn();

    let outcome: Promise<SenderGateResult> = Promise.resolve('ready');
    act(() => { outcome = gate.result.current(onAsk); });
    const dialog = await screen.findByRole('dialog', { name: 'Додати телефон?' });
    expect(onAsk).toHaveBeenCalledOnce();
    expect(within(dialog).getByText(/так буде і в наступних кошторисах/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Пропустити' }));

    await expect(outcome).resolves.toBe('skipped');
    expect(profileApi.updateSender).not.toHaveBeenCalled();
    // The second document in the same session is not asked again.
    await expect(gate.result.current()).resolves.toBe('ready');
    expect(senderGateWouldAsk(noPhone)).toBe(false);
  });

  it('«Зберегти в профілі» saves the phone with the name', async () => {
    vi.mocked(profileApi.updateSender).mockResolvedValue(aUser({ fullName: 'Іван', phone: '+380501112233' }));
    const { gate } = setup(noPhone);

    let outcome: Promise<SenderGateResult> = Promise.resolve('ready');
    act(() => { outcome = gate.result.current(); });
    const dialog = await screen.findByRole('dialog', { name: 'Додати телефон?' });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Ім'я та прізвище/).value).toBe('Іван');
    fireEvent.change(within(dialog).getByLabelText(/Телефон/), { target: { value: '+380501112233' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти в профілі' }));

    await expect(outcome).resolves.toBe('saved');
    expect(profileApi.updateSender).toHaveBeenCalledWith({ fullName: 'Іван', phone: '+380501112233', companyName: '' });
  });

  /** Review: the company is not reminded about — most masters work under their own name. */
  it('says nothing about a missing company when the phone is there', async () => {
    const { gate } = setup(aUser({ companyName: undefined }));
    await expect(gate.result.current()).resolves.toBe('ready');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /** Review: a PDF is not a link to a client — and a first PDF used to cost three taps. */
  it('never reminds before a PDF', async () => {
    const { gate } = setup(noPhone);
    await expect(gate.result.current(undefined, { remind: false })).resolves.toBe('ready');
    expect(senderGateWouldAsk(noPhone, { remind: false })).toBe(false);
  });

  /** Review: the name sheet already offered the phone; a reminder right after it is a repeat. */
  it('does not remind in the session the name sheet was shown', async () => {
    vi.mocked(profileApi.updateSender).mockResolvedValue(noPhone);
    const { gate, qc } = setup();

    let first: Promise<SenderGateResult> = Promise.resolve('ready');
    act(() => { first = gate.result.current(); });
    const dialog = await screen.findByRole('dialog', { name: 'Як вас підписати в документі?' });
    fireEvent.change(within(dialog).getByLabelText(/Ім'я та прізвище/), { target: { value: 'Іван' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти і продовжити' }));
    await expect(first).resolves.toBe('saved');
    qc.setQueryData(ME_QUERY_KEY, noPhone);

    await expect(gate.result.current()).resolves.toBe('ready');
    expect(screen.queryByRole('dialog', { name: 'Додати телефон?' })).toBeNull();
  });
});

describe('useSenderGate — the name is asked whatever the email (share-without-verification)', () => {
  /** An unverified master without a name used to be let through to share, and heard a 403 after. */
  it('asks an unverified master for the name BEFORE anything leaves', async () => {
    const unverified = aUser({ fullName: undefined, emailVerified: false });
    vi.mocked(authApi.me).mockResolvedValue(unverified);
    const { gate } = setup(unverified);

    act(() => { void gate.result.current(); });
    expect(await screen.findByRole('dialog', { name: 'Як вас підписати в документі?' })).toBeTruthy();
    expect(senderGateWouldAsk(unverified)).toBe(true);
  });

  it('lets an unverified master with a name share straight away', async () => {
    const unverified = aUser({ emailVerified: false });
    const { gate } = setup(unverified);

    await expect(gate.result.current(undefined, { remind: false })).resolves.toBe('ready');
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
