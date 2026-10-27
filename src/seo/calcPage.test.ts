import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
