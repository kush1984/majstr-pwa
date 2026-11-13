import { parseDecimal } from '@/lib/parseDecimal.ts';
import { provideLayout } from './layoutBridge.ts';
import { isNarrow, type LayoutPattern, type LayoutStart, type SurfaceLayout } from '@/lib/tileLayout.ts';
import {
  clampOpening,
  DEFAULT_JOINT,
  evaluate,
  laidTile,
  mmToMetres,
  readAsMm,
  roomSurfaces,
  sizeToMm,
  wall,
  type DraftResult,
  type LayoutDraft,
  type SurfaceDraft,
} from '@/features/materials/tileLayoutModel.ts';

/**
 * «Розкладка по стінах» on kalkulyator-plytky.html (iteration-tile-layout, public part). The SAME engine
 * and model the app's layout screen runs (`lib/tileLayout.ts`, `tileLayoutModel.ts`), here with plain
 * DOM: nothing goes to the server, every figure is counted in the visitor's browser as he types.
 */

const root = document.querySelector<HTMLElement>('#layout');

const PATTERNS: [LayoutPattern, string][] = [
  ['STRAIGHT', 'Пряма'], ['OFFSET_1_2', 'Зміщення ½'], ['OFFSET_1_3', 'Зміщення ⅓'], ['OFFSET_1_4', 'Зміщення ¼'],
];
const STARTS: [LayoutStart, string][] = [
  ['AUTO', 'Підібрати авто'], ['SYMMETRIC', 'Симетрично'], ['CORNER', 'Від кута'], ['CENTER', 'Від центру'],
  ['MANUAL', 'Вручну'],
];
const NUDGE_MM = 5;
/** Surfaces whose drawing is a drag handle right now («Посунути вручну»). */
const moving = new Set<string>();
const SIDE: Record<string, string> = { L: 'Зліва', R: 'Справа', B: 'Знизу', T: 'Зверху' };
const HINTS: Record<string, string> = {
  NARROW_UNAVOIDABLE: 'З цим форматом вузька смужка лишиться за будь-якого старту. Інший формат або поворот плитки дасть ширшу.',
  MOSTLY_CUT: 'Підрізки більше, ніж цілих плиток. Менший формат дасть менше відходу.',
  MOSTLY_CUT_START: 'Підрізки більше, ніж цілих плиток. Від кута її було б менше — зате зі смужкою біля стіни.',
  TILE_BIGGER_THAN_SURFACE: 'Плитка більша за поверхню — кожна йде на підрізку.',
  OFFSET_HALF_LONG: 'Для плитки понад 38 см стандарт радить зміщення не більше ⅓, інакше видно перепад між плитками. Перевірте паспорт плитки.',
};
const ERRORS: Record<string, string> = {
  SURFACE: 'Розміри поверхні — від 0,05 до 20 м.',
  TILE: 'Сторона плитки — від 20 до 3600 мм.',
  JOINT: 'Шов має бути вужчим за плитку, до 20 мм.',
  GAP: 'Поверхня замала для такого шва.',
  OPENING: 'Проріз виходить за поверхню або накладається на інший.',
};
/** The area calculator's allowance above — the by-area comparison uses the visitor's own figure. */
function wastePercent(): number {
  const v = Number(document.querySelector<HTMLInputElement>('#calc input[name="wastePercent"]:checked')?.value);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

/** The form's tile has no one size (mosaic, «кабанчик»): nothing to lay out. */
let noSize = false;

let draft: LayoutDraft = {
  version: 1,
  format: { short: 300, long: 600 },
  orientation: 'LANDSCAPE',
  joint: DEFAULT_JOINT,
  surfaces: [wall('Стіна 1', 1850, 2550)],
  unplaced: [],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(label: string, value: string, onInput: (v: string) => void, attrs: Record<string, string> = {}): HTMLLabelElement {
  const l = el('label', {}, label);
  const input = el('input', { inputmode: 'decimal', autocomplete: 'off', value, ...attrs });
  input.addEventListener('input', () => onInput(input.value));
  l.append(input);
  return l;
}

/**
 * A size in METRES, as the app takes it («3,6»); a number too big for metres is read as mm and the
 * field says so. The page keeps mm, like the engine.
 */
function sizeField(label: string, valueMm: number, onMm: (mm: number) => void): HTMLLabelElement {
  const note = el('small', { class: 'seo-tl-echo' });
  const l = field(label, mmToMetres(valueMm), (v) => {
    note.textContent = readAsMm(v) ? `Прочитали як мм: ${mmToMetres(sizeToMm(v))} м` : '';
    onMm(sizeToMm(v));
  });
  l.append(note);
  return l;
}

function select<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLLabelElement {
  const l = el('label', {}, label);
  const s = el('select');
  for (const [v, text] of options) {
    const o = el('option', { value: v }, text);
    if (v === value) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value as T));
  l.append(s);
  return l;
}

// ---- the drawing -------------------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function drawing(s: SurfaceDraft, layout: SurfaceLayout, draggable: boolean): SVGElement {
  const tile = laidTile(draft);
  const box = 300;
  const pad = 18;
  const scale = Math.min((box - 2 * pad) / s.width, (box - 2 * pad) / s.height);
  const vw = s.width * scale + 2 * pad;
  const vh = s.height * scale + 2 * pad;
  const X = (x: number) => pad + x * scale;
  const Y = (y: number, h: number) => pad + (s.height - y - h) * scale;
  const root = svg('svg', {
    viewBox: `0 0 ${vw} ${vh}`, class: draggable ? 'seo-tl-svg seo-tl-drag' : 'seo-tl-svg', role: 'img',
    'aria-label': `Розкладка: ${s.name}`,
  });
  root.append(svg('rect', { x: pad, y: pad, width: s.width * scale, height: s.height * scale, class: 'seo-tl-bg' }));
  for (const p of layout.pieces) {
    const narrowW = p.kind !== 'FULL' && (!p.factory.L || !p.factory.R) && isNarrow(p.w, tile.w) && p.w < tile.w - 0.5;
    const narrowH = p.kind !== 'FULL' && (!p.factory.B || !p.factory.T) && isNarrow(p.h, tile.h) && p.h < tile.h - 0.5;
    const cls = p.kind === 'FULL' ? 'seo-tl-full' : narrowW || narrowH ? 'seo-tl-narrow' : 'seo-tl-cut';
    root.append(svg('rect', {
      x: X(p.x), y: Y(p.y, p.h), width: Math.max(p.w * scale, 0.5), height: Math.max(p.h * scale, 0.5), class: cls,
    }));
  }
  s.openings.forEach((o, i) => {
    root.append(svg('rect', {
      x: X(o.x), y: Y(o.y, o.h), width: o.w * scale, height: o.h * scale, class: 'seo-tl-opening', 'data-opening': i,
    }));
  });
  if (draggable) {
    // Drag the tiles to move the grid, a door or window to move it. The drawing is rebuilt as the layout
    // changes, so the move is followed on the WINDOW: a listener on this element would die with it.
    root.addEventListener('pointerdown', (e) => {
      const hit = (e.target as Element).getAttribute('data-opening');
      const opening = hit == null ? null : Number(hit);
      const from = opening == null ? layout.origin : { x: s.openings[opening].x, y: s.openings[opening].y };
      const rect = root.getBoundingClientRect();
      const unit = rect.width > 0 ? vw / rect.width : 1;
      const px = e.clientX;
      const py = e.clientY;
      e.preventDefault();
      const move = (m: PointerEvent) => {
        if (m.pointerId !== e.pointerId) return;
        const at = {
          x: Math.round(from.x + ((m.clientX - px) * unit) / scale),
          y: Math.round(from.y - ((m.clientY - py) * unit) / scale),
        };
        draft = {
          ...draft,
          surfaces: draft.surfaces.map((x) => {
            if (x.key !== s.key) return x;
            if (opening == null) return { ...x, start: 'MANUAL', origin: at };
            return { ...x, openings: x.openings.map((o, k) => (k === opening ? clampOpening(x, { ...o, ...at }) : o)) };
          }),
        };
        renderResult();
      };
      const end = (u: PointerEvent) => {
        if (u.pointerId !== e.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        render();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }
  for (const e of layout.edges) {
    const t = svg('text', {
      class: e.narrow ? 'seo-tl-label seo-tl-label-narrow' : 'seo-tl-label',
      x: e.side === 'L' ? X(0) : e.side === 'R' ? X(s.width) : 4,
      y: e.side === 'L' || e.side === 'R' ? vh - 4 : e.side === 'T' ? pad + 10 : vh - pad - 2,
      'text-anchor': e.side === 'R' ? 'end' : 'start',
    });
    t.textContent = String(Math.round(e.min));
    root.append(t);
  }
  return root;
}

/** «Посунути вручну»: hands the grid to the visitor from where it stands, with 5 mm nudges for a thumb. */
function moveControls(s: SurfaceDraft, origin: { x: number; y: number }, isMoving: boolean): HTMLElement {
  const box = el('div', { class: 'seo-tl-move' });
  const moveTo = (o: { x: number; y: number }) => {
    draft = { ...draft, surfaces: draft.surfaces.map((x) => (x.key === s.key ? { ...x, start: 'MANUAL', origin: o } : x)) };
    renderResult();
  };
  if (!isMoving) {
    const start = el('button', { type: 'button', class: 'seo-add' }, '✋ Посунути розкладку вручну');
    start.addEventListener('click', () => {
      moving.add(s.key);
      draft = { ...draft, surfaces: draft.surfaces.map((x) => (x.key === s.key ? { ...x, start: 'MANUAL', origin } : x)) };
      render();
    });
    box.append(start);
    return box;
  }
  box.append(el('p', { class: 'seo-small' }, 'Тягніть плитку, щоб зсунути всю сітку, або двері чи вікно, щоб перенести їх. Кількість і смужки перераховуються одразу.'));
  const pad = el('div', { class: 'seo-tl-nudge', role: 'group', 'aria-label': 'Зсув на 5 мм' });
  const nudges: [number, number, string, string][] = [
    [-NUDGE_MM, 0, '◀', 'Ліворуч'], [NUDGE_MM, 0, '▶', 'Праворуч'], [0, NUDGE_MM, '▲', 'Вгору'], [0, -NUDGE_MM, '▼', 'Вниз'],
  ];
  for (const [dx, dy, glyph, label] of nudges) {
    const b = el('button', { type: 'button', 'aria-label': `${label} на 5 мм` }, glyph);
    b.addEventListener('click', () => {
      const cur = draft.surfaces.find((x) => x.key === s.key);
      const from = cur?.start === 'MANUAL' && cur.origin ? cur.origin : origin;
      moveTo({ x: from.x + dx, y: from.y + dy });
    });
    pad.append(b);
  }
  const done = el('button', { type: 'button' }, 'Зафіксувати');
  done.addEventListener('click', () => {
    moving.delete(s.key);
    render();
  });
  pad.append(done);
  box.append(pad);
  return box;
}

// ---- the form ----------------------------------------------------------------------------------

function header(): HTMLElement {
  const box = el('div', { class: 'seo-tl-grid' });
  // The format and the joint are the form's own, above; here only how the tile lies.
  const orient = select('Як лежить плитка', [['LANDSCAPE', 'Лежача'], ['PORTRAIT', 'Стояча']] as ['LANDSCAPE' | 'PORTRAIT', string][],
    draft.orientation, (v) => { draft = { ...draft, orientation: v }; renderResult(); });
  box.append(orient);
  return box;
}

function surfaceCard(s: SurfaceDraft): HTMLElement {
  const card = el('div', { class: 'seo-tl-surface', 'data-key': s.key });
  const set = (patch: Partial<SurfaceDraft>, full = false) => {
    draft = { ...draft, surfaces: draft.surfaces.map((x) => (x.key === s.key ? { ...x, ...patch } : x)) };
    if (full) render(); else renderResult();
  };
  const top = el('div', { class: 'seo-tl-row' });
  const on = el('input', { type: 'checkbox', 'aria-label': `Розкладати «${s.name}»` });
  on.checked = s.enabled;
  on.addEventListener('change', () => set({ enabled: on.checked }));
  const name = el('input', { value: s.name, 'aria-label': 'Назва поверхні', class: 'seo-tl-name' });
  name.addEventListener('input', () => set({ name: name.value }));
  const count = el('b', { class: 'seo-tl-count' });
  top.append(on, name, count);

  const grid = el('div', { class: 'seo-tl-grid' });
  grid.append(
    sizeField(s.floor ? 'Довжина, м' : 'Ширина, м', s.width, (width) => set({ width })),
    sizeField(s.floor ? 'Ширина, м' : 'Висота, м', s.height, (height) => set({ height })),
    select('Розкладка', PATTERNS, s.pattern, (v) => set({ pattern: v })),
    select('Старт', STARTS, s.start, (v) => set({ start: v }, true)),
  );

  const openings = el('div', { class: 'seo-tl-openings' });
  s.openings.forEach((o, i) => {
    const row = el('div', { class: 'seo-tl-opening-row' });
    const put = (k: 'w' | 'h' | 'x' | 'y') => (mm: number) => set({
      openings: s.openings.map((x, j) => (j === i ? { ...x, [k]: mm } : x)),
    });
    row.append(
      sizeField('Ширина, м', o.w, put('w')),
      sizeField('Висота, м', o.h, put('h')),
      sizeField('Від лівого краю, м', o.x, put('x')),
      sizeField('Від підлоги, м', o.y, put('y')),
    );
    const remove = el('button', { type: 'button', class: 'seo-add' }, 'Прибрати проріз');
    remove.addEventListener('click', () => set({ openings: s.openings.filter((_, j) => j !== i) }, true));
    row.append(remove);
    openings.append(row);
  });
  const addOpening = el('button', { type: 'button', class: 'seo-add' }, s.floor ? '+ Виріз (ванна, піддон)' : '+ Двері чи вікно');
  addOpening.addEventListener('click', () => set({
    openings: [...s.openings, { x: 0, y: 0, w: s.floor ? 0 : 700, h: s.floor ? 0 : 2000 }],
  }, true));
  openings.append(addOpening);

  const out = el('div', { class: 'seo-tl-out' });
  const removeSurface = el('button', { type: 'button', class: 'seo-add' }, 'Прибрати поверхню');
  removeSurface.addEventListener('click', () => {
    draft = { ...draft, surfaces: draft.surfaces.filter((x) => x.key !== s.key) };
    render();
  });
  card.append(top, grid, out, openings, removeSurface);
  return card;
}

function render(): void {
  if (!root) return;
  root.replaceChildren();
  if (noSize) {
    root.append(el('p', { class: 'seo-tl-hint' }, 'Мозаїку й кабанчик розкладкою не рахуємо — у них немає одного розміру. Рахуйте за площею.'));
    return;
  }
  root.append(header());

  const room = el('details', { class: 'seo-tl-room' });
  room.append(el('summary', {}, 'Скласти з кімнати: довжина × ширина × висота облицювання'));
  const roomGrid = el('div', { class: 'seo-tl-grid' });
  let rl = 0;
  let rw = 0;
  let rh = 0;
  roomGrid.append(
    sizeField('Довжина, м', 0, (v) => { rl = v; }),
    sizeField('Ширина, м', 0, (v) => { rw = v; }),
    sizeField('Висота облицювання, м', 0, (v) => { rh = v; }),
  );
  const build = el('button', { type: 'button' }, 'Чотири стіни й підлога');
  build.addEventListener('click', () => {
    if (!(rl && rw && rh)) return;
    draft = { ...draft, surfaces: roomSurfaces(rl, rw, rh, 0, { wall: (l) => `Стіна ${l}`, floor: 'Підлога' }) };
    render();
  });
  roomGrid.append(build);
  room.append(roomGrid);
  root.append(room);

  for (const s of draft.surfaces) root.append(surfaceCard(s));

  const adds = el('div', { class: 'seo-tl-grid seo-tl-adds' });
  const addWall = el('button', { type: 'button', class: 'seo-add' }, '+ Стіна');
  addWall.addEventListener('click', () => {
    draft = { ...draft, surfaces: [...draft.surfaces, wall(`Стіна ${draft.surfaces.length + 1}`)] };
    render();
  });
  const addFloor = el('button', { type: 'button', class: 'seo-add' }, '+ Підлога');
  addFloor.addEventListener('click', () => {
    draft = { ...draft, surfaces: [...draft.surfaces, { ...wall('Підлога'), floor: true }] };
    render();
  });
  adds.append(addWall, addFloor);
  root.append(adds);
  renderResult();
}

/** Only the figures and pictures — never the inputs, so typing keeps its focus. */
function renderResult(): void {
  if (!root) return;
  const result: DraftResult = evaluate(draft, 0, wastePercent());
  for (const s of draft.surfaces) {
    const card = root.querySelector<HTMLElement>(`[data-key="${s.key}"]`);
    if (!card) continue;
    const r = result.surfaces.find((x) => x.key === s.key);
    const out = card.querySelector<HTMLElement>('.seo-tl-out');
    const count = card.querySelector<HTMLElement>('.seo-tl-count');
    if (!out || !count) continue;
    out.replaceChildren();
    count.textContent = '';
    if (!s.enabled) continue;
    if (r?.error) {
      out.append(el('p', { class: 'seo-error' }, ERRORS[r.error] ?? ''));
      continue;
    }
    const layout = r?.layout;
    if (!layout) continue;
    count.textContent = layout.minTiles === layout.maxTiles ? `${layout.maxTiles} шт` : `${layout.minTiles}–${layout.maxTiles} шт`;
    const isMoving = moving.has(s.key);
    out.append(drawing(s, layout, isMoving));
    out.append(moveControls(s, layout.origin, isMoving));
    out.append(el('p', { class: 'seo-small' }, `Цілих ${layout.full} · на підрізку ${layout.cut + layout.shaped}`));
    const narrow = layout.edges.filter((e) => e.narrow);
    if (narrow.length > 0) {
      const warn = el('div', { class: 'seo-tl-warn' });
      warn.append(el('p', {}, narrow.map((e) => `${SIDE[e.side]} смужка ${Math.round(e.min)} мм`).join(' · ')));
      if (s.start !== 'AUTO' && !layout.hints.includes('NARROW_UNAVOIDABLE')) {
        const fix = el('button', { type: 'button', class: 'seo-tl-fix' },
          s.pattern === 'STRAIGHT' ? 'Почати симетрично' : 'Підібрати старт');
        fix.addEventListener('click', () => {
          draft = { ...draft, surfaces: draft.surfaces.map((x) => (x.key === s.key ? { ...x, start: s.pattern === 'STRAIGHT' ? 'SYMMETRIC' : 'AUTO' } : x)) };
          render();
        });
        warn.append(fix);
      }
      out.append(warn);
    }
    for (const h of layout.hints) {
      out.append(el('p', { class: 'seo-tl-hint' }, h === 'MOSTLY_CUT' && r.cornerCutsLess ? HINTS.MOSTLY_CUT_START : HINTS[h]));
    }
  }
}

render();

provideLayout(() => {
  if (noSize) return 'NO_SIZE';
  const result = evaluate(draft, 0, wastePercent());
  if (result.laidArea <= 0) return 'EMPTY';
  const tile = laidTile(draft);
  const pieces = result.surfaces.reduce((n, x) => ({
    full: n.full + (x.layout?.full ?? 0),
    cut: n.cut + (x.layout ? x.layout.cut + x.layout.shaped : 0),
  }), { full: 0, cut: 0 });
  return {
    laidArea: Math.round(result.laidArea * 100) / 100,
    buyMin: result.minTiles + result.spare,
    buyMax: result.maxTiles + result.spare,
    spare: result.spare,
    full: pieces.full,
    cut: pieces.cut,
    byArea: result.byArea,
    tileArea: (tile.w * tile.h) / 1e6,
  };
});

// The area calculator above sets the format, the joint and the allowance; the layout follows it, so the
// two halves of the page never answer about different tiles. Mosaic and «кабанчик» have no one size.
const TOP_FORMAT: Record<string, [number, number]> = {
  T100X100: [100, 100], T200X200: [200, 200], T300X300: [300, 300], T300X600: [300, 600], T600X600: [600, 600],
  T600X1200: [600, 1200], T800X1600: [800, 1600], T1200X2400: [1200, 2400],
};
function followTop(): void {
  const calc = document.querySelector<HTMLFormElement>('#calc');
  if (!calc) return;
  const fmt = TOP_FORMAT[calc.querySelector<HTMLSelectElement>('select[name="format"]')?.value ?? ''];
  noSize = fmt === undefined;
  const jointRaw = calc.querySelector<HTMLInputElement>('input[name="jointMm"]')?.value.trim() ?? '';
  const joint = jointRaw === '' ? DEFAULT_JOINT : parseDecimal(jointRaw);
  const next = { ...draft };
  if (fmt) next.format = { short: fmt[0], long: fmt[1] };
  if (Number.isFinite(joint) && joint >= 0 && joint <= 20) next.joint = joint;
  draft = next;
  render();
}
document.querySelector('#calc select[name="format"]')?.addEventListener('change', followTop);
document.querySelector('#calc input[name="jointMm"]')?.addEventListener('input', followTop);
document.querySelectorAll('#calc input[name="wastePercent"]').forEach((i) => i.addEventListener('change', () => renderResult()));
followTop();
