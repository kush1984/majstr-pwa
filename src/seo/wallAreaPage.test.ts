import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The wall-area page's script against the page's OWN markup, as the browser would run it. */
const root = path.resolve(__dirname, '../..');

async function load(): Promise<HTMLFormElement> {
  const html = readFileSync(path.join(root, 'kalkulyator-ploshchi-stin.html'), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.replaceWith(document.importNode(parsed.body, true));
  Element.prototype.scrollIntoView = vi.fn();
  vi.resetModules();
  await import('./wallAreaPage.ts');
  const form = document.querySelector<HTMLFormElement>('#calc');
  if (!form) throw new Error('no #calc form');
  return form;
}

function choose(form: HTMLFormElement, shape: string): void {
  const radio = form.querySelector<HTMLInputElement>(`input[name="shape"][value="${shape}"]`);
  if (!radio) throw new Error(`no shape ${shape}`);
  radio.checked = true;
  form.dispatchEvent(new Event('change', { bubbles: true }));
}

function fill(form: HTMLFormElement, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const input = form.elements.namedItem(name) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const shownPlans = (form: HTMLFormElement) =>
  [...form.querySelectorAll<HTMLElement>('[data-plan]')].filter((el) => !el.hidden).map((el) => el.dataset.plan);
const edgeLetters = () => [...document.querySelectorAll('#plan .seo-plan-edge')].map((t) => t.textContent);
const result = () => document.querySelector<HTMLElement>('#result');

describe('kalkulyator-ploshchi-stin', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('shows only the chosen plan, drawn with the letters its fields carry', async () => {
    const form = await load();
    expect(shownPlans(form)).toEqual(['rect']);
    expect(edgeLetters()).toEqual(['a', 'b']);

    choose(form, 'lshape');
    expect(shownPlans(form)).toEqual(['lshape']);
    expect(edgeLetters()).toEqual(['A', 'B', 'a', 'b']);
  });

  it('counts an L-shaped room: the walls of its overall rectangle, the floor minus the cut-out', async () => {
    const form = await load();
    choose(form, 'lshape');
    fill(form, {
      'lshape-A': '5', 'lshape-B': '4', 'lshape-a': '2', 'lshape-b': '1,5', height: '2,7',
      windowWidth: '1,4', windowHeight: '1,5', windowCount: '2', doorWidth: '0,8', doorHeight: '2',
    });
    form.requestSubmit();

    const text = result()?.textContent ?? '';
    expect(result()?.hidden).toBe(false);
    expect(text).toContain('Стіни без вікон і дверей42,8 м²');
    expect(text).toContain('Підлога17 м²');
    expect(text).toContain('Плінтус (без дверних прорізів)17,2 м');
    expect(result()?.querySelector<HTMLAnchorElement>('.seo-handon')?.getAttribute('href'))
      .toBe('/kalkulyator-shtukaturky?area=42.8');
  });

  it("says why a plan makes no room, in the drawing and on submit, and keeps what he typed", async () => {
    const form = await load();
    choose(form, 'lshape');
    fill(form, { 'lshape-A': '5', 'lshape-B': '4', 'lshape-a': '6', 'lshape-b': '1', height: '2,7' });
    expect(document.querySelector('#plan .seo-plan-warn')?.textContent).toBe('Виріз більший за кімнату — перевірте a і b.');

    form.requestSubmit();
    expect(form.querySelector<HTMLElement>('.seo-error')?.textContent).toBe('Виріз більший за кімнату — перевірте a і b.');
    expect(result()?.hidden).toBe(true);
    expect((form.elements.namedItem('lshape-a') as HTMLInputElement).value).toBe('6');
  });

  it('reports the slanted wall of a cut corner', async () => {
    const form = await load();
    choose(form, 'cut');
    fill(form, { 'cut-a': '4', 'cut-b': '3', 'cut-c': '3', 'cut-d': '2', height: '2,5' });
    form.requestSubmit();
    expect(result()?.textContent).toContain('Скошена стіна (звірте рулеткою)1,41 м');
  });
});
