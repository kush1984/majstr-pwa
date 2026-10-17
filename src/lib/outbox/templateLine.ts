/**
 * A bundle line applied offline: an estimate line created with quantity 0 — «filled per object»,
 * exactly what the server's own bundle application creates. The manual form never lets a 0
 * through, and a «%» line is never a bundle line, so a queued create of that shape can only be one
 * (review P0-5). It replays through `/items/template-line`, the door that accepts it.
 */
export function isTemplateLine(req: { quantity?: unknown; unit?: string } | undefined): boolean {
  return req != null && Number(req.quantity) === 0 && req.unit !== 'PERCENT';
}
