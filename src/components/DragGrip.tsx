import type { useSortable } from '@dnd-kit/sortable';

/**
 * The drag handle for a sortable row. `touch-action: none` is what stops the browser from
 * scrolling the page instead of starting the drag — without it, dragging on a phone simply does
 * not work.
 *
 * Shared so every sortable list in the app grabs the same way: the estimate board's lines and
 * category headers, and a template's positions.
 */
export function DragGrip({
  listeners, attributes, label, stretch,
}: {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
  label: string;
  stretch?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      style={{ touchAction: 'none' }}
      {...attributes}
      {...listeners}
      // A line's grip is the full height of its card; a section's was 20 px tall, so the two were
      // nothing like the same target on a phone — which is most of why categories "practically
      // could not be dragged" there. 44 px is the floor for a thumb, and it matches the height the
      // category checkbox already uses in selection mode, so the header no longer changes height
      // between modes either.
      className={`flex w-7 flex-shrink-0 cursor-grab items-center justify-center rounded-lg text-faint
        active:cursor-grabbing ${stretch ? 'self-stretch' : 'h-11'}`}
    >
      <svg viewBox="0 0 10 16" className="h-4 w-2.5 fill-current" aria-hidden="true">
        <circle cx="2" cy="3" r="1.4" /><circle cx="8" cy="3" r="1.4" />
        <circle cx="2" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" />
        <circle cx="2" cy="13" r="1.4" /><circle cx="8" cy="13" r="1.4" />
      </svg>
    </button>
  );
}
