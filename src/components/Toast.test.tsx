import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ToastViewport } from './Toast.tsx';
import { toast } from '@/hooks/useToast.ts';

describe('ToastViewport action', () => {
  afterEach(() => {
    // Clear any toast still on screen so cases don't bleed into each other.
    act(() => {
      // Dismiss everything currently shown.
      for (let id = 1; id < 100; id += 1) toast.dismiss(id);
    });
  });

  it('renders an action button and runs its onClick, then dismisses the toast', () => {
    render(<ToastViewport />);
    const onClick = vi.fn();

    act(() => {
      toast.success('Кошторис створено', { action: { label: 'Відкрити', onClick } });
    });

    const button = screen.getByRole('button', { name: 'Відкрити' });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    // The toast is gone after the action fires.
    expect(screen.queryByText('Кошторис створено')).toBeNull();
  });

  it('shows no action button for a plain toast', () => {
    render(<ToastViewport />);
    act(() => {
      toast.success('Просто повідомлення');
    });
    expect(screen.getByText('Просто повідомлення')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Відкрити' })).toBeNull();
  });
});

/**
 * The toast is the app's only channel for «це не збереглося», and it spent the whole time being
 * painted UNDER the thing that raised it: the viewport lives inside `#root`, a modal is portalled
 * into `<body>` (appended after it), and at an equal z-index the DOM order decides. The master's
 * report was «вводжу суму і тисну зберегти, а воно просто не зберігає» — the refusal was drawn,
 * behind the sheet. Nothing rendered can catch that (both elements are in the tree and visible to
 * a query), so this reads the SOURCE and pins the one invariant: the toast layer outranks every
 * other overlay. A new overlay above 70 reintroduces the bug silently.
 */
describe('toast layering', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'src/components', file), 'utf8');

  /** The `z-[N]` / `z-N` on real markup — the class attributes, never the prose in a comment. */
  const layers = (source: string) =>
    source
      .split('\n')
      .filter((line) => /className=|'z-/.test(line) && !/^\s*(\*|\/\/)/.test(line))
      .flatMap((line) => [...line.matchAll(/\bz-\[?(\d+)\]?/g)].map(([, n]) => Number(n)));

  const toastLayer = Math.max(...layers(read('Toast.tsx')));

  it.each(['Modal.tsx', 'ActionMenu.tsx', 'InfoPopover.tsx', 'Fab.tsx', 'OfflineBanner.tsx', 'UpdateBanner.tsx'])(
    'sits above every layer in %s',
    (file) => {
      const others = layers(read(file));
      expect(others.length).toBeGreaterThan(0);
      expect(Math.max(...others)).toBeLessThan(toastLayer);
    },
  );
});
