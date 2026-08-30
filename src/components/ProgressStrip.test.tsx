import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressStrip, progressPct } from './ProgressStrip.tsx';

/**
 * The bar greens as it fills, and it does that by showing a WINDOW onto a gradient that spans the
 * whole track. That is the entire design, and it lives in two numbers — the fill's `width` and its
 * `background-size` — so it is asserted here rather than trusted to a class name that would look
 * plausible if someone dropped the size and squeezed the full orange→green ramp into every bar.
 *
 * The client portal draws the same bar in plain CSS (`static/portal/index.html`, `.paybar-fill`),
 * which no test in this repo can see. If these expectations change, that file changes too.
 */
function fill(value: number, total: number) {
  const { unmount } = render(<ProgressStrip value={value} total={total} />);
  const el = screen.getByTestId('progress-fill');
  const style = { width: el.style.width, backgroundSize: el.style.backgroundSize, className: el.className };
  unmount();
  return style;
}

describe('progressPct', () => {
  it('is uncapped — an overpayment must not read as 100 %', () => {
    // The master paid-in figure can exceed the contracted total; printing «100 %» would round away
    // money he then cannot find on the screen.
    expect(progressPct(112_000, 100_000)).toBe(112);
  });

  it('is 0 when there is nothing to divide by', () => {
    expect(progressPct(5000, 0)).toBe(0);
    expect(progressPct(0, 0)).toBe(0);
  });

  it('rounds to whole percents', () => {
    expect(progressPct(1, 3)).toBe(33);
    expect(progressPct(2, 3)).toBe(67);
  });
});

describe('ProgressStrip', () => {
  it('stretches the gradient to the TRACK, so a short bar shows only its orange end', () => {
    const { width, backgroundSize } = fill(25, 100);
    expect(width).toBe('25%');
    // 4× the fill: only the first quarter of the orange→green ramp is inside the window.
    expect(backgroundSize).toBe('400% 100%');
  });

  it('shows a green tail as it nears the end', () => {
    const { width, backgroundSize } = fill(80, 100);
    expect(width).toBe('80%');
    expect(backgroundSize).toBe('125% 100%');
  });

  it('goes solid green at 100 % — «closed» is a state, not one more percent', () => {
    const { width, backgroundSize, className } = fill(100, 100);
    expect(width).toBe('100%');
    expect(className).toContain('bg-success');
    expect(className).not.toContain('bg-gradient-to-r');
    expect(backgroundSize).toBe('');
  });

  it('stays solid green on an overpayment, with the width clamped', () => {
    const { width, className } = fill(120, 100);
    expect(width).toBe('100%');
    expect(className).toContain('bg-success');
  });

  it('draws nothing at zero without dividing by it', () => {
    const { width, backgroundSize } = fill(0, 100);
    expect(width).toBe('0%');
    expect(backgroundSize).toBe('');
  });

  it('reports the uncapped percent to assistive tech', () => {
    render(<ProgressStrip value={112} total={100} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('112');
  });
});
