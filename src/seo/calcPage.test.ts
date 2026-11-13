import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// One instance across vi.resetModules(), so a test can see what the freshly imported page sent.
const { trackPage } = vi.hoisted(() => ({ trackPage: vi.fn() }));
vi.mock('@/lib/visit.ts', () => ({ trackPage }));

/**
 * The calculator pages' script against the page's OWN markup: the real HTML file is loaded into the
 * document and calcPage.ts is imported fresh, as the browser would run it.
 */
const root = path.resolve(__dirname, '../..');

async function load(file: string): Promise<HTMLFormElement> {
  const html = readFileSync(path.join(root, file), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.replaceWith(document.importNode(parsed.body, true));
  vi.resetModules();
  await import('./calcPage.ts');
  const form = document.querySelector<HTMLFormElement>('#calc');
  if (!form) throw new Error(`${file} has no #calc form`);
  return form;
}

function choose(form: HTMLFormElement, name: string, value: string): void {
  const radio = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!radio) throw new Error(`no ${name}=${value}`);
  radio.checked = true;
  form.dispatchEvent(new Event('change', { bubbles: true }));
}

function visibleText(form: HTMLFormElement, selector: string): string[] {
  return [...form.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => !el.hidden)
    .map((el) => el.textContent?.trim() ?? '');
}

describe('kalkulyator-gipsokartonu', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('counts its own visit, by its own path', async () => {
    trackPage.mockClear();
    await load('kalkulyator-gipsokartonu.html');

    expect(trackPage).toHaveBeenCalledOnce();
    expect(trackPage).toHaveBeenCalledWith(window.location.pathname);
  });

  it('names the area of a partition as ONE face, and only for a partition', async () => {
    const form = await load('kalkulyator-gipsokartonu.html');

    // Ceiling is the page's default job.
    expect(visibleText(form, 'label span[data-for]')).toEqual(['Площа, м²']);

    choose(form, 'work', 'PARTITION');
    expect(visibleText(form, 'label span[data-for]')).toEqual(['Площа перегородки (з одного боку), м²']);
    expect(visibleText(form, 'small[data-for="PARTITION"]')).toEqual(['Довжина × висота.']);

    choose(form, 'work', 'WALL');
    expect(visibleText(form, 'label span[data-for]')).toEqual(['Площа, м²']);
    expect(visibleText(form, 'small[data-for="PARTITION"]')).toEqual([]);
  });

  it('asks the perimeter for a ceiling and the layers for a partition, nothing else', async () => {
    const form = await load('kalkulyator-gipsokartonu.html');
    const perimeter = () => form.querySelector<HTMLElement>('label[data-for="CEILING"]')?.hidden;
    const layers = () => form.querySelector<HTMLElement>('fieldset[data-for="PARTITION"]')?.hidden;

    expect([perimeter(), layers()]).toEqual([false, true]);
    choose(form, 'work', 'PARTITION');
    expect([perimeter(), layers()]).toEqual([true, false]);
    choose(form, 'work', 'WALL');
    expect([perimeter(), layers()]).toEqual([true, true]);
  });
});

/** The body calcPage.ts POSTs on submit — fetch is stubbed with an empty answer. */
async function submitted(form: HTMLFormElement): Promise<{ calculator: string; inputs: Record<string, unknown> }> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ materials: [], wastePercent: 10, missing: [] }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  form.requestSubmit();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as { calculator: string; inputs: Record<string, unknown> };
}

function type(form: HTMLFormElement, name: string, value: string): void {
  const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(`no input ${name}`);
  input.value = value;
}

describe('kalkulyator-shtukaturky', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('asks how it is applied only for gypsum — the library has no machine cement-lime', async () => {
    const form = await load('kalkulyator-shtukaturky.html');
    const method = () => form.querySelector<HTMLElement>('fieldset[data-show="plaster:GYPSUM"]')?.hidden;

    expect(method()).toBe(false);
    choose(form, 'plaster', 'CEMENT_LIME');
    expect(method()).toBe(true);
    choose(form, 'plaster', 'GYPSUM');
    expect(method()).toBe(false);
  });

  it('reads a comma, and sends no method for cement-lime even if machine was picked before', async () => {
    const form = await load('kalkulyator-shtukaturky.html');
    type(form, 'area', '34,5');
    type(form, 'thicknessMm', '12,5');
    choose(form, 'method', 'MACHINE');
    choose(form, 'plaster', 'CEMENT_LIME');

    const body = await submitted(form);

    expect(body.calculator).toBe('PLASTER');
    expect(body.inputs).toEqual({ area: 34.5, wastePercent: 10, thicknessMm: 12.5, plaster: 'CEMENT_LIME' });
  });

  it('leaves an empty thickness out — the server takes the position\'s own', async () => {
    const form = await load('kalkulyator-shtukaturky.html');
    type(form, 'area', '20');

    const body = await submitted(form);

    expect(body.inputs).toEqual({ area: 20, wastePercent: 10, plaster: 'GYPSUM', method: 'MANUAL' });
  });
});

describe('kalkulyator-styazhky', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('changes the thickness hint with the screed kind, and offers mesh and film for cement only', async () => {
    const form = await load('kalkulyator-styazhky.html');
    const ticks = () => form.querySelector<HTMLElement>('fieldset[data-show="screed:CEMENT"]')?.hidden;

    expect(visibleText(form, 'small[data-show]')).toEqual([expect.stringContaining('від 10 до 100 мм')]);
    expect(ticks()).toBe(false);

    choose(form, 'screed', 'SELF_LEVELLING');
    expect(visibleText(form, 'small[data-show]')).toEqual([expect.stringContaining('від 2 до 30 мм')]);
    expect(ticks()).toBe(true);
  });

  it('sends the ticks and the optional perimeter for cement, with commas', async () => {
    const form = await load('kalkulyator-styazhky.html');
    type(form, 'area', '15,5');
    type(form, 'thicknessMm', '45');
    type(form, 'perimeter', '16,2');
    const mesh = form.querySelector<HTMLInputElement>('input[name="withMesh"]');
    if (!mesh) throw new Error('no mesh tick');
    mesh.checked = true;

    const body = await submitted(form);

    expect(body.calculator).toBe('SCREED');
    expect(body.inputs).toEqual({
      area: 15.5, wastePercent: 10, thicknessMm: 45, screed: 'CEMENT', withMesh: true, withFilm: false, perimeter: 16.2,
    });
  });

  it('drops the ticks for a self-levelling floor, and the perimeter when left empty', async () => {
    const form = await load('kalkulyator-styazhky.html');
    type(form, 'area', '20');
    const film = form.querySelector<HTMLInputElement>('input[name="withFilm"]');
    if (!film) throw new Error('no film tick');
    film.checked = true;
    choose(form, 'screed', 'SELF_LEVELLING');

    const body = await submitted(form);

    expect(body.inputs).toEqual({ area: 20, wastePercent: 10, screed: 'SELF_LEVELLING' });
  });
});

/** The wall-area page's result links here with `?area=` — the field arrives filled, in the visitor's comma. */
describe('a hand-on from the wall-area page', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('prefills the area and the perimeter the page has, and ignores junk', async () => {
    window.history.replaceState(null, '', '/kalkulyator-styazhky?area=12.5&perimeter=14&ownNorm=9');
    const form = await load('kalkulyator-styazhky.html');
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    expect([value('area'), value('perimeter')]).toEqual(['12,5', '14']);

    window.history.replaceState(null, '', '/kalkulyator-shtukaturky?area=-3');
    const plaster = await load('kalkulyator-shtukaturky.html');
    expect((plaster.elements.namedItem('area') as HTMLInputElement).value).toBe('');
    window.history.replaceState(null, '', '/');
  });
});

describe('kalkulyator-plytky — one form, two ways to count', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/kalkulyator-plytky');
  });

  /** Both page scripts, as the page loads them: they share the layout bridge. */
  async function loadTile(): Promise<HTMLFormElement> {
    const form = await load('kalkulyator-plytky.html');
    await import('./tileLayoutPage.ts');
    return form;
  }

  const shown = (form: HTMLFormElement, selector: string) =>
    !(form.querySelector<HTMLElement>(selector)?.hidden ?? true);

  function answer(): Response {
    const line = (name: string, unit: string, quantity: number, packages: number | null, packageName: string | null) => ({
      name, unit, baseQuantity: quantity, quantity, wastePercent: 10, packageSize: null, packageName, packages,
      boxSize: null, boxes: null, sources: [],
    });
    return new Response(JSON.stringify({
      materials: [line('Плитка 300×600 мм', 'M2', 5.2, 29, 'плитка'), line('Клей для плитки цементний C1', 'KG', 22, 1, 'мішок'),
        line('Затирка для швів цементна', 'KG', 1, 1, 'пачка')],
      wastePercent: 10, missing: [],
    }), { status: 200 });
  }

  it('asks the area by area, and the walls by layout — never both', async () => {
    const form = await loadTile();
    expect(shown(form, 'label[data-show="mode:AREA"]')).toBe(true);
    expect(shown(form, '#layout-section')).toBe(false);

    choose(form, 'mode', 'LAYOUT');
    expect(shown(form, 'label[data-show="mode:AREA"]')).toBe(false);
    expect(shown(form, '#layout-section')).toBe(true);
    // The diagonal is the area count's; a layout is laid straight or offset, wall by wall.
    expect(shown(form, 'fieldset[data-show="mode:AREA"]')).toBe(false);
    expect(form.querySelector('#layout .seo-tl-surface')).not.toBeNull();
  });

  it('by layout: the tile from the rows, and the adhesive and grout in the same answer, on the laid m²', async () => {
    const form = await loadTile();
    choose(form, 'mode', 'LAYOUT');
    const fetchMock = vi.fn().mockResolvedValue(answer());
    vi.stubGlobal('fetch', fetchMock);
    form.requestSubmit();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      inputs: { area: number; layout: string; format: string };
    };
    // The page's sample wall, 1,85 × 2,55 m, is what is laid.
    expect(body.inputs.area).toBeGreaterThan(4.6);
    expect(body.inputs.area).toBeLessThan(4.8);
    expect(body.inputs.layout).toBe('STRAIGHT');

    const result = document.querySelector<HTMLElement>('#result');
    await vi.waitFor(() => expect(result?.hidden).toBe(false));
    const text = result?.textContent ?? '';
    expect(text).toContain('Розкладено');
    expect(text).toMatch(/Плиток\d+(–\d+)? шт/);
    expect(text).not.toContain('Площа з запасом');
    expect(text).toContain('Клей для плитки цементний C1');
    expect(text).toContain('Затирка для швів цементна');
  });

  it('by area: as before — the area with the allowance', async () => {
    const form = await loadTile();
    type(form, 'area', '5');
    const fetchMock = vi.fn().mockResolvedValue(answer());
    vi.stubGlobal('fetch', fetchMock);
    form.requestSubmit();
    const result = document.querySelector<HTMLElement>('#result');
    await vi.waitFor(() => expect(result?.hidden).toBe(false));
    expect(result?.textContent).toContain('Площа з запасом');
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).inputs.area).toBe(5);
  });

  it('a mosaic has no one size: the layout says so, and nothing is sent', async () => {
    const form = await loadTile();
    choose(form, 'mode', 'LAYOUT');
    const format = form.querySelector<HTMLSelectElement>('select[name="format"]');
    if (!format) throw new Error('no format');
    format.value = 'MOSAIC';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    expect(form.querySelector('#layout')?.textContent).toContain('Мозаїку й кабанчик розкладкою не рахуємо');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    form.requestSubmit();
    expect(form.querySelector('.seo-error')?.textContent).toContain('перемкніть на «За площею + запас»');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a link to #layout-section opens the form on the layout', async () => {
    window.history.replaceState(null, '', '/kalkulyator-plytky#layout-section');
    const form = await loadTile();
    expect(form.querySelector<HTMLInputElement>('input[name="mode"][value="LAYOUT"]')?.checked).toBe(true);
    expect(shown(form, '#layout-section')).toBe(true);
  });
});
