import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '@/lib/i18n.ts';
import { useClientPreview } from './useClientPreview.ts';
import { toast } from '@/hooks/useToast.ts';

vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
// The name gate is exercised on its own (SenderSheetHost.test); here it answers per test.
const ensureSender = vi.fn();
vi.mock('@/features/sender/senderGate.ts', () => ({ useSenderGate: () => ensureSender }));

const fetchUrl = vi.fn<() => Promise<string>>();

let tab: { opener: unknown; closed: boolean; location: { href: string }; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  ensureSender.mockResolvedValue('ready');
  tab = { opener: 'app', closed: false, location: { href: '' }, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
});

describe('useClientPreview', () => {
  it('reserves the tab before any await, then sends it to the preview pass', async () => {
    let tabWhenReadyRan = 0;
    const ready = vi.fn(() => {
      tabWhenReadyRan = vi.mocked(window.open).mock.calls.length;
      return Promise.resolve(true);
    });
    fetchUrl.mockResolvedValue('https://api.majstr.test/portal/index.html?v=abc.def');
    const { result } = renderHook(() => useClientPreview(fetchUrl, ready));

    await act(async () => { await result.current.open(); });

    // On iOS the tap is spent by the first await — the window must already exist by then.
    expect(tabWhenReadyRan).toBe(1);
    expect(fetchUrl).toHaveBeenCalledOnce();
    expect(tab.location.href).toBe('https://api.majstr.test/portal/index.html?v=abc.def');
    // The client's page never gets a handle back into the app.
    expect(tab.opener).toBeNull();
  });

  it('closes the reserved tab when the queue is not clear, and asks the server for nothing', async () => {
    const { result } = renderHook(() => useClientPreview(fetchUrl, () => Promise.resolve(false)));

    await act(async () => { await result.current.open(); });

    expect(tab.close).toHaveBeenCalled();
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it('asks the name first, and «Зберегти і продовжити» opens the preview — no second press', async () => {
    const second = { opener: 'app', closed: false, location: { href: '' }, close: vi.fn() };
    // The sheet spends the first tap; its own continue tap reserves a new tab, then the save lands.
    ensureSender.mockImplementation(async (onAsk: () => void, opts: { onContinueTap: () => () => void }) => {
      onAsk();
      vi.mocked(window.open).mockReturnValue(second as unknown as Window);
      opts.onContinueTap();
      return 'saved';
    });
    fetchUrl.mockResolvedValue('https://api.majstr.test/portal/index.html?v=abc.def');
    const { result } = renderHook(() => useClientPreview(fetchUrl, () => Promise.resolve(true)));

    await act(async () => { await result.current.open(); });

    expect(ensureSender).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({ remind: false, onContinueTap: expect.any(Function) }));
    expect(tab.close).toHaveBeenCalled();
    expect(second.location.href).toBe('https://api.majstr.test/portal/index.html?v=abc.def');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('still asks for a second press when the sheet closed without a continue tap', async () => {
    ensureSender.mockImplementation(async (onAsk: () => void) => { onAsk(); return 'skipped'; });
    const { result } = renderHook(() => useClientPreview(fetchUrl, () => Promise.resolve(true)));

    await act(async () => { await result.current.open(); });

    expect(fetchUrl).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Натисніть «Подивитися, як побачить клієнт» ще раз');
  });

  it('says nothing when the name sheet is closed without a name', async () => {
    ensureSender.mockResolvedValue('cancelled');
    const { result } = renderHook(() => useClientPreview(fetchUrl, () => Promise.resolve(true)));

    await act(async () => { await result.current.open(); });

    expect(fetchUrl).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('closes the tab and says why when the server refuses', async () => {
    fetchUrl.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useClientPreview(fetchUrl, () => Promise.resolve(true)));

    await act(async () => { await result.current.open(); });

    expect(tab.close).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
