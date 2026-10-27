import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { FAQ_COUNT, LandingPage } from './LandingPage.tsx';
import uk from '@/locales/uk.json';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

const root = path.resolve(__dirname, '../../..');
const indexHtml = () => readFileSync(path.join(root, 'index.html'), 'utf8');
const llmsTxt = () => readFileSync(path.join(root, 'public', 'llms.txt'), 'utf8');

/**
 * The landing is a promise the app has to keep. These words have each been on a draft of it and
 * each describes something Majstr does not have: team accounts, companies, analytics, reviews.
 */
const NOT_A_PROMISE_WE_KEEP = ['команд', 'компаній', 'аналітик', 'відгук'];

describe('LandingPage', () => {
  it('keeps «Увійти» — masters open the landing to get into their account too', () => {
    renderLanding();

    expect(screen.getByRole('link', { name: 'Увійти' }).getAttribute('href')).toBe('/login');
  });

  it('sends every «Спробувати безкоштовно» to registration', () => {
    renderLanding();

    const ctas = screen.getAllByRole('link', { name: /Спробувати безкоштовно/ });
    expect(ctas.length).toBeGreaterThanOrEqual(3);
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/register');
  });

  it('shows all nine questions', () => {
    renderLanding();

    expect(screen.getByText('Це застосунок з App Store чи Google Play?')).toBeTruthy();
    expect(screen.getByText('Як скласти кошторис на ремонт у Majstr?')).toBeTruthy();
    expect(document.querySelectorAll('details')).toHaveLength(9);
  });

  it('promises nothing the app does not have — on the page, in the static copy, in llms.txt', () => {
    renderLanding();
    const texts = {
      page: document.body.textContent ?? '',
      'index.html': indexHtml(),
      'llms.txt': llmsTxt(),
    };
    for (const [where, text] of Object.entries(texts)) {
      for (const word of NOT_A_PROMISE_WE_KEEP) {
        expect(text.toLowerCase(), `${where} says «${word}»`).not.toContain(word);
      }
    }
  });
});

/** Structured data must describe what is ON the page — the FAQ JSON-LD mirrors uk.json word for word. */
describe('the FAQ structured data', () => {
  it('carries exactly the visible questions and answers', () => {
    const blocks = [...indexHtml().matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]) as { '@type': string; mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }> });
    const faq = blocks.find((b) => b['@type'] === 'FAQPage');
    const landing = uk.landing as Record<string, string>;

    expect(faq?.mainEntity?.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
      Array.from({ length: FAQ_COUNT }, (_, i) => [landing[`faqQ${i + 1}`], landing[`faqA${i + 1}`]]),
    );
  });
});
