import './seo.css';
import { config } from '@/lib/config.ts';
import { parseDecimal } from '@/lib/parseDecimal.ts';

/**
 * The static calculator pages (kalkulyator-plytky.html, kalkulyator-gipsokartonu.html): the form is
 * already in the HTML for bots and humans alike; this only reads it, asks
 * `POST /api/public/materials/calc` — the app's own arithmetic — and prints the answer with the
 * same explanation the app's «Показати розрахунок» gives. No framework, no analytics SDK: the page
 * has to paint instantly, and an anonymous visitor has no analytics consent to give.
 */

interface SourceLine {
  name: string | null;
  ownNorm: boolean;
  unit: string;
  quantity: number;
  qtyPerUnit: number;
  basis: string;
  param: number | null;
  amount: number;
}

interface MaterialLine {
  name: string;
  unit: string;
  baseQuantity: number;
  quantity: number;
  wastePercent: number;
  packageSize: number | null;
  packageName: string | null;
  packages: number | null;
  boxSize: number | null;
  boxes: number | null;
  sources: SourceLine[];
}

interface CalcResponse {
  materials: MaterialLine[];
  wastePercent: number | null;
  missing: string[];
}

const UNIT: Record<string, string> = {
  KG: 'кг', M2: 'м²', LINEAR_METER: 'м.п.', PIECE: 'шт', LITRE: 'л', M3: 'м³',
};
const PACKAGE_GENITIVE: Record<string, string> = {
  мішок: 'мішків', пачка: 'пачок', каністра: 'каністр', лист: 'листів', упаковка: 'упаковок',
  відро: 'відер', рулон: 'рулонів', плитка: 'плиток',
};
const number = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 });

const form = document.querySelector<HTMLFormElement>('#calc');
const result = document.querySelector<HTMLElement>('#result');
const errorBox = form?.querySelector<HTMLElement>('.seo-error') ?? null;
const calculator = document.body.dataset.calculator as 'TILE' | 'DRYWALL' | undefined;

/** The visitor's own adhesive norm: what he typed, what was applied, and why it was refused. */
let ownNormDraft = '';
let ownNorm: number | null = null;
let ownNormError: string | null = null;
let focusOwnNorm = false;
let lastResponse: CalcResponse | null = null;

function text(tag: string, content: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className) el.className = className;
  return el;
}

function unit(u: string): string {
  return UNIT[u] ?? u;
}

/** A figure the visitor typed: comma or dot, spaces allowed — the app's own parser. Null when blank or not a number. */
function figure(name: string): number | null {
  const raw = (form?.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
  if (raw === '') return null;
  const value = parseDecimal(raw);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

function checked(name: string): string | null {
  return form?.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null;
}

/**
 * Only the questions that apply to the chosen job are on screen (perimeter → ceiling, layers →
 * partition), and the area is named for it — a partition's is ONE face. `data-for` lists the jobs.
 */
function syncDrywallFields(): void {
  if (calculator !== 'DRYWALL' || !form) return;
  const work = checked('work');
  form.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => {
    el.hidden = work == null || !(el.dataset.for ?? '').split(' ').includes(work);
  });
}

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function inputs(): Record<string, unknown> | null {
  if (!form) return null;
  const area = figure('area');
  if (area == null || Number.isNaN(area)) {
    showError('Вкажіть площу в м² — наприклад, 12,5.');
    return null;
  }
  const out: Record<string, unknown> = { area, wastePercent: Number(checked('wastePercent') ?? 10) };
  if (calculator === 'TILE') {
    out.format = (form.elements.namedItem('format') as HTMLSelectElement).value;
    const joint = figure('jointMm');
    if (joint != null && Number.isNaN(joint)) {
      showError('Ширина шва — число в міліметрах, наприклад 3.');
      return null;
    }
    if (joint != null) out.jointMm = joint;
    out.layout = checked('layout') ?? 'STRAIGHT';
    const box = figure('boxArea');
    if (box != null && Number.isNaN(box)) {
      showError('М² в коробці — число, наприклад 1,44. Або залиште поле порожнім.');
      return null;
    }
    if (box != null) out.boxArea = box;
    if (ownNorm != null) out.ownNorm = ownNorm;
  } else {
    const work = checked('work');
    out.work = work;
    if (work === 'CEILING') {
      const perimeter = figure('perimeter');
      if (perimeter == null || Number.isNaN(perimeter)) {
        showError('Для стелі потрібен периметр кімнати в метрах — по ньому йде профіль UD.');
        return null;
      }
      out.perimeter = perimeter;
    }
    if (work === 'PARTITION') out.layers = Number(checked('layers') ?? 1);
  }
  return out;
}

function packagesText(m: MaterialLine): string {
  const amount = `${number.format(m.quantity)} ${unit(m.unit)}`;
  if (m.packages == null || m.packageName == null) return amount;
  return `${PACKAGE_GENITIVE[m.packageName] ?? m.packageName}: ${m.packages} (${amount})`;
}

/** «Демонтаж…: 12 м² × 5,2 = 62,4 кг» — the app's arithmetic line, one per position. */
function sourceText(s: SourceLine, m: MaterialLine): string {
  const label = s.name ?? 'Периметр';
  const base = `${number.format(s.quantity)} ${unit(s.unit)}`;
  const param = s.param != null ? ` × ${number.format(s.param)}` : '';
  return `${label}: ${base}${param} × ${number.format(s.qtyPerUnit)} = ${number.format(s.amount)} ${unit(m.unit)}`;
}

function explanation(m: MaterialLine): HTMLElement {
  const how = document.createElement('details');
  how.append(text('summary', 'Показати розрахунок'));
  for (const s of m.sources) how.append(text('p', sourceText(s, m)));
  how.append(text('p', `Разом ${number.format(m.baseQuantity)} ${unit(m.unit)} + запас ${number.format(m.wastePercent)} %, округлено вгору до цілих упаковок.`));
  return how;
}

/** The tile page's main material — the adhesive, C1 or C2 by format. Only it takes an own norm. */
function isMainMaterial(m: MaterialLine): boolean {
  return calculator === 'TILE' && m.name.startsWith('Клей');
}

function materialList(materials: MaterialLine[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'seo-materials';
  for (const m of materials) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'seo-material-row';
    row.append(text('span', m.name), text('b', packagesText(m)));
    li.append(row);
    const own = m.sources.length > 0 && m.sources.every((s) => s.ownNorm);
    if (own) li.append(text('p', `За вашою нормою ${number.format(m.sources[0].qtyPerUnit)} кг/м²`, 'seo-own-note'));
    li.append(explanation(m));
    if (isMainMaterial(m)) li.append(ownNormBlock(m, own));
    list.append(li);
  }
  return list;
}

/**
 * «Своя норма з упаковки»: one optional figure, in the unit our own norm is written in, sent as
 * `ownNorm` — the server applies it exactly as a master's own norm. Empty = ours again.
 */
function ownNormBlock(m: MaterialLine, own: boolean): HTMLElement {
  const block = document.createElement('details');
  block.className = 'seo-own-norm';
  block.open = own || ownNormError != null;
  block.append(text('summary', 'Своя норма з упаковки'));
  const label = document.createElement('label');
  label.append('Клей з упаковки, кг/м²');
  const input = document.createElement('input');
  input.name = 'ownNorm';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.value = ownNormDraft;
  input.placeholder = own ? '' : number.format(m.sources[0]?.qtyPerUnit ?? 0);
  label.append(input);
  block.append(label);
  block.append(text('small', own
    ? 'Порожнє поле — повернемо нашу норму.'
    : `Наша норма для цього формату — ${number.format(m.sources[0]?.qtyPerUnit ?? 0)} кг/м². Пишіть так, як на мішку: кг на 1 м².`));
  if (ownNormError) block.append(text('p', ownNormError, 'seo-error'));
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Перерахувати';
  apply.addEventListener('click', () => {
    ownNormDraft = input.value.trim();
    ownNormError = null;
    if (ownNormDraft === '') {
      ownNorm = null;
    } else {
      const value = parseDecimal(ownNormDraft);
      if (!Number.isFinite(value) || value <= 0) {
        ownNormError = 'Норма — число в кг/м², наприклад 1,6.';
        if (lastResponse) render(lastResponse, false);
        return;
      }
      ownNorm = value;
    }
    focusOwnNorm = true;
    form?.requestSubmit();
  });
  block.append(apply);
  return block;
}

/** The tile itself: the area with the allowance, the pieces, and the boxes when the box was given. */
function tileBlock(m: MaterialLine): HTMLElement {
  const block = document.createElement('div');
  block.className = 'seo-tile';
  block.append(text('h3', m.name));
  const facts = document.createElement('dl');
  const fact = (label: string, value: string) => facts.append(text('dt', label), text('dd', value));
  fact('Площа з запасом', `${number.format(m.quantity)} м²`);
  if (m.packages != null) fact('Плиток', `${m.packages} шт`);
  if (m.boxes != null && m.boxSize != null) fact('Коробок', `${m.boxes} (по ${number.format(m.boxSize)} м²)`);
  block.append(facts, explanation(m));
  return block;
}

function render(res: CalcResponse, scroll = true): void {
  if (!result) return;
  result.replaceChildren();
  result.append(text('h2', 'Що купити'));
  if (res.materials.length === 0) {
    result.append(text('p', 'Для цього варіанта ми не знаємо норм — порахуйте в застосунку за позиціями кошторису.'));
  }
  // On the tile page the one line sold by the m² is the tile; everything else is what goes under it.
  const tiles = calculator === 'TILE' ? res.materials.filter((m) => m.unit === 'M2') : [];
  const rest = res.materials.filter((m) => !tiles.includes(m));
  for (const tile of tiles) result.append(tileBlock(tile));
  if (tiles.length > 0 && rest.length > 0) result.append(text('h3', 'Клей, затирка, ґрунт'));
  if (rest.length > 0) result.append(materialList(rest));
  if (res.materials.some((m) => m.name.startsWith('Профіль'))) {
    result.append(text('p', 'Профіль продають по 3–4 м. Скільки штук купити, залежить від висоти стелі й розмірів кімнати — у застосунку це видно в списку покупок.', 'seo-small'));
  }
  const cta = document.createElement('a');
  cta.href = '/register';
  cta.className = 'seo-cta-button';
  cta.textContent = 'Порахувати весь ремонт із кошторисом для клієнта — безкоштовно';
  result.append(cta);
  result.hidden = false;
  if (focusOwnNorm) {
    focusOwnNorm = false;
    result.querySelector('.seo-own-norm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (scroll) {
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function submit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (errorBox) errorBox.hidden = true;
  const body = inputs();
  if (!body || !calculator) return;
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/public/materials/calc`, {
      method: 'POST',
      // The page is Ukrainian whatever the browser's language — its error texts must be too.
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'uk' },
      body: JSON.stringify({ calculator, inputs: body }),
    });
    if (res.status === 429) {
      showError('Забагато розрахунків за хвилину. Спробуйте трохи пізніше.');
      return;
    }
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as { message?: string } | null;
      const message = problem?.message ?? 'Не вдалося порахувати. Перевірте числа й спробуйте ще раз.';
      if (body.ownNorm != null && lastResponse) {
        // Refused for his own norm (out of range): say so where he typed it, keep the last answer.
        ownNorm = null;
        ownNormError = message;
        render(lastResponse, false);
        return;
      }
      showError(message);
      return;
    }
    ownNormError = null;
    lastResponse = (await res.json()) as CalcResponse;
    render(lastResponse);
  } catch {
    // A failed fetch is not always the visitor's internet: the server may be down or redeploying.
    showError(
      navigator.onLine
        ? 'Сервіс тимчасово недоступний. Спробуйте за хвилину.'
        : 'Немає з\'єднання. Перевірте інтернет і спробуйте ще раз.',
    );
  } finally {
    if (button) button.disabled = false;
  }
}

form?.addEventListener('submit', (e) => void submit(e));
form?.addEventListener('change', syncDrywallFields);
syncDrywallFields();
