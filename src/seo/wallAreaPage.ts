import './seo.css';
import { parseDecimal } from '@/lib/parseDecimal.ts';
import { captureFirstTouch, captureRefFromUrl, captureUtmFromUrl } from '@/lib/referral.ts';
import { buildPlaneOutline, type Built } from '@/lib/shapes.ts';
import { DIAGRAM_H, DIAGRAM_W, layoutDiagram } from '@/lib/shapeDiagramLayout.ts';
import { PLAN_SHAPES, buildPlan, wallArea, type Opening, type PlanShape, type Room, type WallArea } from './wallArea.ts';

/**
 * The wall-area page (kalkulyator-ploshchi-stin.html): pure geometry, so unlike calcPage.ts it asks
 * no server — the answer is computed here by the same function the build prints the table with.
 * The result hands its areas on to the plaster and screed calculators (`?area=`), which prefill.
 * The room's plan is one of the app's shapes, drawn with the app's letters (shapeDiagramLayout.ts).
 */

const form = document.querySelector<HTMLFormElement>('#calc');
const result = document.querySelector<HTMLElement>('#result');
const errorBox = form?.querySelector<HTMLElement>('.seo-error') ?? null;
const number = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

function text(tag: string, content: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className) el.className = className;
  return el;
}

/** Blank → null; not a positive number → NaN. Comma or dot, as the app parses it. */
function figure(input: HTMLInputElement | null): number | null {
  const raw = input?.value.trim() ?? '';
  if (raw === '') return null;
  const value = parseDecimal(raw);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

/** shapes.ts's warnings, said for a ROOM's plan (the app's texts speak of a wall). */
const PLAN_WARNINGS: Record<string, string> = {
  'shape.warn.cutTooBig': 'Виріз більший за кімнату — перевірте a і b.',
  'shape.warn.cutTopLonger': 'Верхня стіна довша за нижню — перевірте a і c.',
  'shape.warn.cutRightLonger': 'Права стіна довша за ліву — перевірте b і d.',
};

function chosenShape(): PlanShape {
  const value = form?.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value;
  return PLAN_SHAPES.find((s) => s === value) ?? 'rect';
}

/** The plan's sizes as typed: blank → 0 (not measured yet), junk → NaN. Keyed by the shape's letters. */
function planValues(shape: PlanShape): Record<string, number> {
  const values: Record<string, number> = {};
  form?.querySelectorAll<HTMLInputElement>(`[data-plan="${shape}"] input`).forEach((input) => {
    const key = input.name.slice(shape.length + 1);
    values[key] = figure(input) ?? 0;
  });
  return values;
}

const SVG = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>, content?: string): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (content != null) el.textContent = content;
  return el;
}

/** The plan with its letters — the app's ShapeDiagram, without React. Dimmed until the sizes form a room. */
function drawPlan(): void {
  const box = document.querySelector<HTMLElement>('#plan');
  if (!box) return;
  const shape = chosenShape();
  const values = planValues(shape);
  const valid = Object.values(values).every((v) => !Number.isNaN(v));
  const built: Built = valid ? buildPlan({ shape, values }) : { ...buildPlaneOutline(shape, 'd'), ok: false };
  const layout = layoutDiagram(built, buildPlaneOutline(shape, 'd'));
  const svg = svgEl('svg', { viewBox: `0 0 ${DIAGRAM_W} ${DIAGRAM_H}`, class: 'seo-plan-svg' });
  const g = svgEl('g', layout.dimmed ? { opacity: 0.35 } : {});
  g.append(svgEl('polygon', { points: layout.points.map((p) => p.join(',')).join(' '), class: 'seo-plan-shape' }));
  for (const e of layout.edgeLabels) {
    g.append(svgEl('text', { x: e.p[0], y: e.p[1], class: 'seo-plan-edge', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, e.tag));
  }
  for (const v of layout.vertexLabels) {
    g.append(svgEl('text', { x: v.p[0], y: v.p[1], class: 'seo-plan-vertex', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, v.name));
  }
  svg.append(g);
  const caption = built.ok
    ? null
    : text('p', (built.warnKey && PLAN_WARNINGS[built.warnKey]) ?? 'Впишіть розміри — літера в полі та сама, що на кресленні.', built.warnKey ? 'seo-plan-warn' : 'seo-small');
  box.replaceChildren(svg, ...(caption ? [caption] : []));
}

/** Only the chosen shape's fields are on screen. */
function syncShape(): void {
  const shape = chosenShape();
  form?.querySelectorAll<HTMLElement>('[data-plan]').forEach((el) => {
    el.hidden = el.dataset.plan !== shape;
  });
  drawPlan();
}

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

/** Every filled row of one kind; a row with no width and no height is simply not there. */
function openings(kind: 'window' | 'door'): Opening[] | null {
  const rows = form?.querySelectorAll<HTMLElement>(`[data-openings="${kind}"] .seo-opening`) ?? [];
  const out: Opening[] = [];
  for (const row of rows) {
    const [w, h, n] = Array.from(row.querySelectorAll('input')).map(figure);
    if (w == null && h == null) continue;
    if (w == null || h == null || Number.isNaN(w) || Number.isNaN(h) || Number.isNaN(n ?? 0)) {
      showError(kind === 'window'
        ? 'Для вікна вкажіть ширину й висоту в метрах — наприклад, 1,4 і 1,5.'
        : 'Для дверей вкажіть ширину й висоту в метрах — наприклад, 0,8 і 2.');
      return null;
    }
    out.push({ width: w, height: h, count: Math.round(n ?? 1) || 1 });
  }
  return out;
}

function row(dl: HTMLElement, label: string, value: string): void {
  dl.append(text('dt', label), text('dd', value));
}

/** A link to a material calculator carrying the area — the target page prefills its field. */
function handOn(label: string, page: string, params: Record<string, number>): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `${page}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  a.className = 'seo-handon';
  a.textContent = label;
  return a;
}

function render(r: WallArea, height: number): void {
  if (!result) return;
  const m2 = (n: number) => `${number.format(n)} м²`;
  const m = (n: number) => `${number.format(n)} м`;
  result.replaceChildren();
  result.append(text('h2', 'Площі кімнати'));
  const box = text('div', '', 'seo-tile');
  const dl = document.createElement('dl');
  row(dl, 'Стіни без вікон і дверей', m2(r.wallsNet));
  row(dl, 'Стіни разом із прорізами', m2(r.wallsGross));
  if (r.windows > 0) row(dl, 'Вікна', m2(r.windows));
  if (r.doors > 0) row(dl, 'Двері', m2(r.doors));
  row(dl, 'Стеля', m2(r.floor));
  row(dl, 'Підлога', m2(r.floor));
  row(dl, 'Периметр', m(r.perimeter));
  row(dl, 'Плінтус (без дверних прорізів)', m(r.skirting));
  if (r.slope != null) row(dl, 'Скошена стіна (звірте рулеткою)', m(r.slope));
  box.append(dl);
  const how = document.createElement('details');
  how.append(
    text('summary', 'Як порахували'),
    text('p', `Стіни: ${number.format(r.perimeter)} м × ${number.format(height)} м = ${m2(r.wallsGross)}.`),
    text('p', `Мінус вікна ${m2(r.windows)} і двері ${m2(r.doors)} = ${m2(r.wallsNet)}.`),
    text('p', `Плінтус: периметр ${m(r.perimeter)} мінус ширина дверей = ${m(r.skirting)}.`),
  );
  box.append(how);
  result.append(box);

  const next = text('div', '', 'seo-handons');
  next.append(
    text('p', 'Скільки купити на цю площу:', 'seo-small'),
    handOn(`Штукатурка на ${m2(r.wallsNet)} стін →`, '/kalkulyator-shtukaturky', { area: r.wallsNet }),
    handOn(`Стяжка на ${m2(r.floor)} підлоги →`, '/kalkulyator-styazhky', { area: r.floor, perimeter: r.perimeter }),
  );
  result.append(next);

  const cta = document.createElement('a');
  cta.href = '/register';
  cta.className = 'seo-cta-button';
  cta.textContent = 'Порахувати весь ремонт із кошторисом для клієнта — безкоштовно';
  result.append(cta);
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submit(event: SubmitEvent): void {
  event.preventDefault();
  if (!form) return;
  if (errorBox) errorBox.hidden = true;
  const shape = chosenShape();
  const values = planValues(shape);
  if (Object.values(values).some((v) => !(v > 0))) {
    showError('Вкажіть усі розміри кімнати в метрах — кожну сторону, позначену літерою на кресленні.');
    return;
  }
  const plan: Room['plan'] = { shape, values };
  const planBuilt = buildPlan(plan);
  if (!planBuilt.ok) {
    showError((planBuilt.warnKey && PLAN_WARNINGS[planBuilt.warnKey]) ?? 'З такими розмірами кімната не складається — перевірте їх.');
    return;
  }
  const height = figure(form.elements.namedItem('height') as HTMLInputElement | null);
  if (height == null || Number.isNaN(height)) {
    showError('Вкажіть висоту стелі в метрах — наприклад, 2,7.');
    return;
  }
  const windows = openings('window');
  if (!windows) return;
  const doors = openings('door');
  if (!doors) return;
  const r = wallArea({ plan, height, windows, doors });
  if (r) render(r, height);
}

/** «+ Вікно іншого розміру»: one more empty row of the same kind, focused. */
function addRow(kind: string): void {
  const set = form?.querySelector<HTMLElement>(`[data-openings="${kind}"]`);
  const first = set?.querySelector<HTMLElement>('.seo-opening');
  if (!set || !first) return;
  const copy = first.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('input').forEach((input) => {
    input.value = '';
    input.removeAttribute('name');
  });
  set.insertBefore(copy, set.querySelector('.seo-add'));
  copy.querySelector('input')?.focus();
}

// First-touch attribution, as calcPage.ts does — this page is often a search visitor's first.
captureRefFromUrl(window.location.search);
captureUtmFromUrl(window.location.search);
captureFirstTouch(document.referrer, window.location.pathname, window.location.hostname);

form?.addEventListener('submit', submit);
form?.addEventListener('change', syncShape);
form?.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).closest('[data-plan]')) drawPlan();
});
syncShape();
form?.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((button) =>
  button.addEventListener('click', () => addRow(button.dataset.add ?? '')),
);
