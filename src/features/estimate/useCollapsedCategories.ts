import { useCallback, useEffect, useState } from 'react';

/**
 * Per-estimate remember-what-was-collapsed. Kept in `localStorage`, keyed on estimate id, so the
 * master's fold state survives a refresh but is not sent to the server and never leaks between
 * estimates. Empty set = everything expanded, which is the default the master asked for.
 *
 * <p>Category keys are the literal `category` string on the item (blank string for «Без категорії»).
 * The key is chosen deliberately: renaming a category on the backend would surface as a NEW header
 * with an empty collapse memory — the safe side, since a fold state carried onto a renamed
 * category would show the master a collapsed «Каркас» that he never collapsed by that name.</p>
 */

const KEY = (estimateId: string) => `estimate:${estimateId}:collapsed`;

function readStored(estimateId: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(KEY(estimateId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeStored(estimateId: string, ids: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (ids.size === 0) localStorage.removeItem(KEY(estimateId));
    else localStorage.setItem(KEY(estimateId), JSON.stringify([...ids]));
  } catch {
    // Quota exceeded / private mode — the master just loses persistence, not the app.
  }
}

export interface CollapseAPI {
  isCollapsed(category: string): boolean;
  toggle(category: string): void;
}

export function useCollapsedCategories(estimateId: string): CollapseAPI {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readStored(estimateId));

  // Reset on estimate switch — a different sheet must not inherit the previous one's fold state.
  useEffect(() => setCollapsed(readStored(estimateId)), [estimateId]);

  const isCollapsed = useCallback((category: string) => collapsed.has(category), [collapsed]);
  const toggle = useCallback(
    (category: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        writeStored(estimateId, next);
        return next;
      });
    },
    [estimateId],
  );

  return { isCollapsed, toggle };
}
