import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpeechDictation } from './useSpeechDictation.ts';

/**
 * The hook is a lifecycle wrapper around the platform's SpeechRecognition. Two facts to pin:
 *   1. every runtime error takes the button off the screen for this session — never explodes;
 *   2. `no-speech` / `aborted` are NOT failures — one is silence, the other is the master pressing stop.
 */

interface FakeRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

let created: FakeRec[] = [];

function makeFake(): FakeRec {
  const rec: FakeRec = {
    lang: '',
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onresult: null,
    onerror: null,
    onend: null,
  };
  created.push(rec);
  return rec;
}

const w = window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown };

beforeEach(() => {
  created = [];
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126', configurable: true,
  });
  Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  w.webkitSpeechRecognition = function () { return makeFake(); };
});

afterEach(() => {
  delete w.webkitSpeechRecognition;
  delete w.SpeechRecognition;
});

describe('useSpeechDictation', () => {
  it('is available when the platform is ready, and start/stop drive the recogniser', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechDictation({ onFinal }));
    expect(result.current.available).toBe(true);

    act(() => result.current.start());
    expect(created).toHaveLength(1);
    expect(created[0].start).toHaveBeenCalledTimes(1);
    expect(created[0].continuous).toBe(false); // NEVER true, iOS-hang comment on the hook
    expect(result.current.listening).toBe(true);

    act(() => result.current.stop());
    expect(created[0].stop).toHaveBeenCalledTimes(1);
  });

  it('a `not-allowed` error takes the button off the screen for this session', () => {
    const { result } = renderHook(() => useSpeechDictation({ onFinal: vi.fn() }));
    act(() => result.current.start());

    act(() => created[0].onerror?.({ error: 'not-allowed' }));

    expect(result.current.blocked).toBe('denied');
    expect(result.current.available).toBe(false);
  });

  it('a `no-speech` error is silence, not a failure — button stays on', () => {
    const { result } = renderHook(() => useSpeechDictation({ onFinal: vi.fn() }));
    act(() => result.current.start());

    act(() => created[0].onerror?.({ error: 'no-speech' }));

    expect(result.current.blocked).toBeNull();
    expect(result.current.available).toBe(true);
  });

  it('a final result reaches onFinal; an interim one only updates the caption', () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechDictation({ onFinal }));
    act(() => result.current.start());

    act(() => created[0].onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: 'поклеїти шпа' } } },
    }));
    expect(onFinal).not.toHaveBeenCalled();
    expect(result.current.interim).toBe('поклеїти шпа');

    act(() => created[0].onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'поклеїти шпалери' } } },
    }));
    expect(onFinal).toHaveBeenCalledWith('поклеїти шпалери');
  });
});
