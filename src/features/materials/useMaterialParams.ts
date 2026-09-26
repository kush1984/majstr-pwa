/**
 * The figures the calculator cannot derive — the room's perimeter, a короб's розгортка, a layer's
 * thickness — remembered per ESTIMATE, in `localStorage`, from the moment the master taps
 * «Порахувати» (his ruling: «якщо вже майстер натиснув розрахувати, то воно це діло запамʼятовує
 * автоматично»).
 *
 * <p>Why it is stored at all: the calculation itself stores nothing (V127 — the GET recomputes),
 * so before this the answers lived in React state and died with the screen. He typed the thickness,
 * sent the materials to the shopping list, came back an hour later and the same card asked the same
 * question with our default in it — while the list on the home screen already held the answer. The
 * question is not re-asked; the numbers are simply back where he left them.</p>
 *
 * <p>Why the CLIENT and not a column: a thickness is an answer about the work he is doing right
 * now, the calculator is a scratchpad by design, and the storage is keyed on the estimate so
 * nothing leaks between objects. Lost storage costs him one re-entry, not a wrong shopping list —
 * exactly what `useCollapsedCategories` trades away for the same reason.</p>
 *
 * <p>Values are kept as the RAW strings he typed, not as numbers: they go straight back into the
 * fields, and «12,5» must come back as «12,5» and not as «12.5».</p>
 */

const KEY = (estimateId: string) => `materials:${estimateId}:params`;

export interface StoredParams {
  /** One figure for the whole estimate; «» = not answered. */
  perimeter: string;
  /** Keyed by estimate item id — one розгортка per position (V131). */
  sections: Record<string, string>;
  /** Keyed by estimate item id — one thickness per position, in millimetres (V137). */
  thicknesses: Record<string, string>;
}

const EMPTY: StoredParams = { perimeter: '', sections: {}, thicknesses: {} };

function strings(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

export function readParams(estimateId: string): StoredParams {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY(estimateId));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const record = parsed as Record<string, unknown>;
    return {
      perimeter: typeof record.perimeter === 'string' ? record.perimeter : '',
      sections: strings(record.sections),
      thicknesses: strings(record.thicknesses),
    };
  } catch {
    return EMPTY;
  }
}

/** Merges one answer into what is already stored — the three are applied by three buttons. */
export function saveParams(estimateId: string, patch: Partial<StoredParams>): void {
  if (typeof localStorage === 'undefined') return;
  const next = { ...readParams(estimateId), ...patch };
  try {
    if (!next.perimeter && Object.keys(next.sections).length === 0
        && Object.keys(next.thicknesses).length === 0) {
      localStorage.removeItem(KEY(estimateId));
      return;
    }
    localStorage.setItem(KEY(estimateId), JSON.stringify(next));
  } catch {
    // Quota exceeded / private mode — he loses the memory, not the calculation.
  }
}
