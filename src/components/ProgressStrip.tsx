/**
 * The one progress strip of the object economy. «Отримано» (payments), «Прийнято актами» and
 * «Отримано» on the works axis all draw THIS bar — and so does the client portal's payments card,
 * which is plain HTML with its own copy of the rule (`static/portal/index.html`, `.paybar-fill`).
 * Four places, one design: change the rule here and the portal's CSS in the same commit.
 *
 * **Colour is a POSITION, never a verdict.** The brand→success gradient always spans the whole
 * TRACK (that is what `backgroundSize` is doing), and the fill is a window onto it — so a strip at
 * 30 % shows only the orange end and one at 90 % shows a green tail. It greens as it grows without
 * any point on it ever changing colour. The alternative — interpolating ONE flat hue by percent —
 * paints a half-done object entirely in the transitional olive between the two tokens, which on a
 * money screen reads as a warning when nothing is wrong; here that olive is only ever the leading
 * edge of a bar that is still mostly brand orange.
 *
 * At 100 % the fill goes solid green: «closed» is a state the master should be able to spot across
 * the room, not one more percent of a gradient.
 */

/**
 * Percent for the LABEL — deliberately uncapped. An overpayment is real (a client can pay more
 * than the contracted total) and printing it as «100 %» is the bar quietly rounding away money
 * the master then can't find. The width clamps; the number does not.
 */
export function progressPct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function ProgressStrip({ value, total }: { value: number; total: number }) {
  const pct = progressPct(value, total);
  const width = Math.max(0, Math.min(100, pct));
  const complete = pct >= 100;
  return (
    <div
      className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        data-testid="progress-fill"
        className={`h-full rounded-full transition-[width] ${
          complete ? 'bg-success' : 'bg-gradient-to-r from-brand to-success'
        }`}
        // Stretch the gradient to the TRACK, not to the fill: at 25 % the image is 4× as wide as
        // the fill, so only its orange quarter is visible. Without this every strip would show the
        // full orange→green ramp squeezed into whatever width it happens to have.
        style={{
          width: `${width}%`,
          ...(complete || width === 0 ? {} : { backgroundSize: `${(100 / width) * 100}% 100%` }),
        }}
      />
    </div>
  );
}
