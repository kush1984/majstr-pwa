/**
 * The «✓ Отримано · 5» / «✓ Куплено · 14» header that folds a run of finished rows away.
 *
 * Extracted from `PaymentsBlock` when the shopping list needed the same fold: the pattern is a
 * green summary line with a chevron, and a second hand-written copy would drift the moment one of
 * them gained a state. It carries no data of its own — the caller owns what «finished» means.
 */
export function CollapseGroupRow({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex min-h-11 w-full items-center gap-2 border-b border-border py-2 text-left text-[13px] font-semibold text-success last:border-b-0"
    >
      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-success" aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="flex-shrink-0 font-normal text-muted" aria-hidden>{expanded ? '︿' : '⌄'}</span>
    </button>
  );
}
