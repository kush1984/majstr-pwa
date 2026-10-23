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
