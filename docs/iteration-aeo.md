# Iteration — AEO / technical SEO (iteration-aeo)

**Status:** ✅ shipped (PWA only, no backend change, no migration)
**App version:** 1.30.0
**Prompt:** `C:\Work\prompts\aeo-prompt.md` (from the Chyzh Agency audit, 25.08.2026, 52/100)

## Goal

Do the parts of the audit that are actually worth doing, fix a real accuracy gap the
audit did not see, and be honest in the docs about how much of that score is
speculative. Scope was deliberately narrowed by three facts verified by hand 31.08.2026:
the catch-all `_redirects` (`/*  /index.html  200`) makes any missing path return 200 +
landing HTML, so the scanner's "llms.txt exists but thin / GPTBot blocked" findings are
artifacts, not truths; and `llms.txt`/`ai.txt` have **no confirmed crawler support** yet
carry ~24 of the 100 audit points — so the score is not a measure of product state.

## What shipped

### Chunk 1 — the parts Google actually consumes
- **`index.html` `Organization` extended** — `description`, `email`, `foundingDate`
  (`"2026"`), `areaServed: "UA"`, `knowsLanguage: ["uk"]`, `contactPoint`. This is the
  entity signal the audit flagged red ("Бренд як сутність"). **No `sameAs`** — it must
  list only real, live profiles, and a fabricated/empty one is a broken signal worse than
  none; a comment marks where it goes (LinkedIn / GitHub org / Facebook / Instagram) once
  those exist.
- **Visible FAQ + `FAQPage` JSON-LD** — a 7-question accordion in `LandingPage.tsx`
  (`landing.faqQ1..A7`) plus matching `FAQPage` JSON-LD in `index.html`, **word-for-word**
  in Ukrainian (the default render language). Structured data must describe on-page
  content, so the two are kept in lockstep (asserted by a throwaway parity script during
  the gate; the rule is in `CLAUDE.md` → Public landing). The FAQ is also where **work
  acts** finally appear on the landing (see accuracy fix below).
- **`robots.txt`** — added the routes that had appeared since it was last touched
  (`/acts`, `/templates`, `/forgot-password`, `/reset-password`, `/billing`) and a single
  `Disallow: /portal/` that closes every client-portal kind at once (`?p=`/`?e=`/`?a=`/`?t=`
  all live under `/portal/index.html` — personal data + money, must never be indexed).
- **`public/_headers`** — new file, **CSP is Report-Only on purpose**. A hard CSP that
  gets an origin wrong fails silently in prod (broken monobank / dead Sentry+PostHog);
  report-only blocks nothing and only reports, so it runs ~a week, then the missing
  origins get added, then it's flipped to enforced. Accounts for Google Fonts, PostHog
  (EU), Sentry ingest; same-origin `/api` is covered by `'self'`.
- **`sitemap.xml`** — left as `/` + `/privacy` (adding app routes would contradict
  robots — a direct negative signal). Adding a page = adding a `<loc>`; nothing invented.

### Chunk 2 — cheap, no illusions
- **`public/llms.txt`** and **`public/.well-known/ai.txt`** — real files now (both were
  previously phantom 200s from the catch-all). Each carries a dated in-file comment saying
  it is a non-standard convention with no confirmed crawler support, so nobody counts it
  as a working channel later. `ai.txt` `Allow`s GPTBot/ClaudeBot/PerplexityBot/
  Google-Extended/Applebot-Extended/Bingbot; it is a declaration of intent, **not** an
  access mechanism — `robots.txt` is the real control. Build verified both survive the
  copy into `dist/` (incl. the `.well-known/` dot-directory).

### Accuracy fix (the part the audit did not see)
Re-verified the whole indexable surface against the live DB and `PlanConfig`:
- **"140 готових шаблонів" → "120+"** in `index.html`, `uk.json`, `en.json`. The live
  default-template count is **122** (V112 rebuilt bundles: PAINTER 21→3, dropped the
  Фасадні bundle). The old hard number had gone stale and was overstated.
- **"960+ робіт" → "1000+"** (live catalog is **1092** works) — was true but understated.
  Counts in copy are soft floors; the DB is the source of truth.
- **Заміри / Економіка PRO badges** — these are PRO in the permanent plan but currently
  **temp-free** (`TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY`). Per the "accurate as of today"
  brief, the landing now shows them as free, driven off that flag so the badge snaps back
  to PRO automatically when the temp unlock is reverted (the landing is now the flag's
  4th consumer — noted in `tempFreeUnlocks.ts`). The stale code comment claiming "FREE has
  only CLIENT_PORTAL / ONLINE_SIGNATURE / PHOTO_REPORTS" was corrected.
- **Work acts were absent from the landing entirely** — a whole shipped feature. Added via
  the FAQ (accurate, low-risk, no hero redesign).

The privacy policy (`PrivacyPage.tsx`, the other indexable page) was already current —
its PostHog section (EU/Frankfurt, session recording, consent gate, portal not recorded,
registration source) is accurate; no change needed.

## Deliberately NOT done (see prompt)
SPA-fallback → real 404 (the catch-all carries deep links, refresh, the monobank return
redirect, installed-PWA relaunch — a missed prefix = a broken link on a live product, and
after Chunk 2 the "file exists" symptom disappears on its own). Wikidata (needs
independent press or the entry gets deleted — worse than none). `/ai/*.json` (invented,
no crawler looks for it — `FAQPage` does the same job through a real mechanism). Person
schema (needs a cited human first). Content depth 4/12 (SEO articles, not an eng task).

## Honesty note (keep)
`llms.txt` and `ai.txt` are a **cheap bet with no confirmed crawler support** as of 2026
(Google likens `llms.txt` to the keywords meta tag; OpenAI/Perplexity don't mention it;
SE Ranking's 300k-domain study found it adds noise, not signal). The **52/100 audit score
includes ~24 points for these speculative files**, so it is **not a measure of the
product's real state** — don't draw product conclusions from it. **`sameAs` is
intentionally omitted** until real social/dev profiles exist.

## Gate
`npm run lint` → `npx tsc -b` → `npm run typecheck:tests` → `npx vitest run` (762 green) →
`npx vite build`. Plus: both JSON-LD schemas parse and the `FAQPage` matches `uk.json`
word-for-word (throwaway Node script, not committed); all `public/` files present in
`dist/` including `.well-known/ai.txt`.
