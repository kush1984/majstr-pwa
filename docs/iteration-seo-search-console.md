# Iteration — SEO fixes from Search Console, and the sign-up buttons on public pages (PWA 1.94.1)

**Status:** shipped 2026-11-26 (backend `8122530`, PWA 1.94.1 `6c138e9`). PWA + one line map in the backend's
static admin page; no migration.
**Source:** Google Search Console queries with impressions and no clicks, and our own visit statistics
(V187/V188: scroll depth, engaged time, clicks by `data-track`).

## Headings: was → now

| Page | Was | Now |
|---|---|---|
| `/kalkulyator-gipsokartonu` title | Калькулятор гіпсокартону та профілю — листи, профіль, кріплення | Калькулятор гіпсокартону — розрахунок профілю, листів і саморізів |
| … H1 | Калькулятор гіпсокартону та профілю | Калькулятор гіпсокартону — розрахунок профілю, листів і саморізів |
| … description | Порахуйте листи ГКЛ, профіль CD/UD або CW/UW, підвіси й саморізи… | Розрахунок профілю для гіпсокартону: скільки профілю CD/UD або CW/UW, листів ГКЛ, підвісів і саморізів… |
| `/zrazok-akta` title | Зразок акта виконаних робіт на ремонт — приклад із сумою прописом | Зразок акта виконаних робіт з матеріалами — приклад із сумою прописом |
| … H1 | Зразок акта виконаних робіт на ремонт | Зразок акта виконаних робіт з матеріалами |
| … description | Зразок акта виконаних робіт для ФОП: роботи за кошторисом, додаткові роботи… | Зразок акта виконаних робіт з використанням матеріалів: роботи й матеріали за кошторисом, чеки… |
| `/` title | Majstr — програма для складання кошторису на ремонт з телефона | Majstr (Майстер Про) — програма для складання кошторису на ремонт з телефона |
| … description | Програма для кошторису на ремонт: … | Majstr (Майстер Про) — програма для кошторису на ремонт: … |
| `/kalkulyator-ploshchi-stin` title | Калькулятор площі стін — мінус вікна й двері, площа стелі й підлоги | Калькулятор площі стін за розмірами кімнати — мінус вікна й двері |
| … H1 | Калькулятор площі стін — з вікнами й дверима | Калькулятор площі стін за розмірами кімнати — з вікнами й дверима |
| … description | Порахуйте площу стін кімнати без вікон і дверей… | Площа стін за розмірами кімнати: введіть розміри стін — довжину, ширину й висоту… |

og/twitter titles, the WebPage JSON-LD and `llms.txt` say the same; `sitemap.xml` lastmod 2026-11-26 for the
five pages whose text changed.

## What changed

1. **«Розрахунок профілю для гіпсокартону»** (query: «розрахунок профілю для гіпсокартону», 43 / 0). A section
   saying what UD and CD go where, with two examples printed by a new build marker `<!--SEO_PROFILE:<id>-->`
   (`profileText`: only the «Профіль …» lines of a snapshot case, label first). The cases are the snapshot's
   existing ceiling 18 m² / perimeter 17 m and wall 30 m², given ids (`drywall-ceiling`, `drywall-wall`) in
   `seo-calc-cases.ts`; `npm run seo:snapshot` wrote only the two ids, every figure unchanged; `seo:check` ✓.
   The prose types no number of its own.
2. **«Як показати в акті матеріали»** (query: «акт виконаних робіт з використанням матеріалів», 18 / 0). Only
   what the app does: estimate material lines carried into the act; receipts for materials bought with the
   master's own money — photo mandatory, a batch now and sums later, every sum needed before signing
   (`ActReceiptCompleteness`); a partial return billed as the difference (V115); the client sees the receipts
   with an openable photo on the act page and in the PDF, their sum added to «До сплати»; posted to the
   object's expenses on sign by default (`receipts_to_expenses`).
3. **The Cyrillic name** («майстер про», «містр», «майстром», ~40 / 0): title and description, `alternateName:
   ["Майстер Про", "Майстр"]` on Organization and SoftwareApplication, one footer line `landing.footerAlsoKnown`
   (uk + en). The FAQ and its JSON-LD untouched.
4. **«розміри стін»** (7): the wall-area page's title, H1 and description.
5. **The sample estimate** (60 % read to the end, median 48 s, 0 sign-ups from a first visit): «Скласти такий
   самий кошторис зі своїми цінами →» right under the table with «Безкоштовно: 2 обʼєкти, без картки.»; on a
   phone (≤ 640 px) a bar pinned to the bottom, «Скласти свій кошторис →» — shown once the TABLE (not the
   document's head, already on the first screen) is half up the screen, hidden while the button under the
   table or the final CTA is in view, so one screen never offers the same thing twice (`stickyCtaShown`). The
   page keeps room for it (`.seo-page:has(.seo-sticky-cta)` padding) and the iPhone home indicator its own
   (`env(safe-area-inset-bottom)`). The final CTA is unchanged.
6. **«Ви майстер? Рахуйте матеріали прямо в кошторисі для клієнта →»** between the form and the answer on every
   calculator — `src/seo/masterLine.ts`, called by `calcPage.ts` AND `wallAreaPage.ts` (the wall-area page has
   its own script, so the line lives in a module both import rather than in calcPage.ts alone). A quiet link,
   padded to a thumb's height. The block after the answer (`masterCta`) keeps its words.
7. **Every sign-up button named** for the visit statistics: `sample:after-table`, `sample:sticky`,
   `sample:final`, `act:final`, `calc:top`, `calc:after-result`, `calc:final` (the click carries the page's
   path, so one label per role is enough). `visit.ts` already reads `data-track` first. The backend's admin
   page (`CLICK_NAMES`) gives each a human name.

## Gate

PWA: lint → tsc -b → typecheck:tests → vitest (2169) → vite build → e2e offline shell (12) ✓; `seo:check` ✓.
Backend: `InlineScriptStringsTest` ✓ (admin page). 375 × 812 screenshots: every changed page, no horizontal
scroll; the sticky bar hidden at the top, shown on the table, hidden at the final CTA.

## After the push

Ask Google to re-crawl the five URLs (Search Console → URL inspection → Request indexing): `/`,
`/kalkulyator-gipsokartonu`, `/kalkulyator-ploshchi-stin`, `/zrazok-akta`, `/zrazok-koshtorysu`.
