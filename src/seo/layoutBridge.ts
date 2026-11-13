/**
 * The tile page's one form counts two ways (owner, 2026-11-14): «За площею + запас», or «По розкладці на
 * стінах». The layout lives in `tileLayoutPage.ts`, the «Порахувати» answer in `calcPage.ts`; this is what
 * the second asks of the first. Both page scripts import this one module, so they share its state.
 */
export interface LayoutSummary {
  /** m² the enabled surfaces cover — what the adhesive, grout and primer are counted on. */
  laidArea: number;
  /** Tiles to buy, the breakage spare included: less if offcuts go back in, more if every cut is a new tile. */
  buyMin: number;
  buyMax: number;
  spare: number;
  full: number;
  cut: number;
  /** What «за площею» would have bought for the same m², at the visitor's allowance. */
  byArea: number;
  /** One tile's face, m² — boxes are counted from it. */
  tileArea: number;
}

/** Why there is no layout to count: nothing laid out yet, or a tile with no one size. */
export type LayoutRefusal = 'EMPTY' | 'NO_SIZE';

let provider: (() => LayoutSummary | LayoutRefusal) | null = null;

export function provideLayout(fn: () => LayoutSummary | LayoutRefusal): void {
  provider = fn;
}

export function layoutSummary(): LayoutSummary | LayoutRefusal {
  return provider ? provider() : 'EMPTY';
}
