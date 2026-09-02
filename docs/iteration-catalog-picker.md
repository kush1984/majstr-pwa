# Iteration — one catalog picker, and it opens on the categories

PWA `1.31.0 → 1.32.0`. **PWA only** — no backend change, no migration. One backend field that already
existed (`CatalogItemResponse.description`, V116) is rendered for the first time.

---

## What the master said

> «Не класифіковано, не систематизовано, плоскі списки, логічна цепочка як дерево програми просто
> відсутня, малярні роботи збери в малярні роботи плиточні в плиточні і так далі, шапка тап
> відкривається малярні, тап плиточні і так далі, не потрібно тап інформація звернулася — не
> навантажуй відразу всім, прайс тетріса бачив голова кипить як там кошторис створити? В тебе теж
> саме.»

He is describing our «Додати позицію» screen, and he is right: it rendered the master's whole
catalog as one flat scrolling list. After the DRYWALL rebuild (V116/V117) a two-trade master carries
well over a hundred positions there. The categories he keeps them under — the ones the catalog page
groups by, the ones the estimate itself prints — simply were not on that screen.

---

## The picker opens on the folders

`features/catalog/CatalogPicker.tsx`. Positions are grouped into their **category**, collapsed; a tap
opens one and leaves the rest shut.

The grouping is `toSections` — the same function `CatalogBoard` groups by, not a second copy of the
arithmetic. A category therefore means exactly the same thing on both screens, and rows keep the
master's own `sortOrder`.

**Trade stays a chip row, not a level of the tree.** A master's catalog holds only the trades he
works, most often one — `TradeFilterChips` already hides itself below two chips — so a trade level
would be a tap that answers nothing. The volume, and the complaint, live *inside* one trade.

**A short catalog is left open.** `AUTO_EXPAND_MAX_ITEMS = 10` (or a single category): a flat list was
never the problem at that size, and collapsing it would only add a tap to a screen that was fine.
This is also what keeps the existing `AddItemSheet` tests meaningful rather than merely passing —
their fixtures are small, so they still assert on rows.

**Search shows only the categories that HAVE a hit, and flattens nothing.** A category with no
match does not render at all; the ones that remain are expanded and their header becomes an inert
label: the heading still says *where* a hit lives (that is the "logical chain" he asked for), but
a folder collapsed earlier while browsing can never swallow a result. Browsing is what the folders are for; search is for when you already know the name.
`CatalogPicker.test.tsx` pins exactly that case — open a folder, shut it, then search into it.

A closed folder shows the count of positions inside, and a **brand pill with how many of them are
already picked** — without it the basket count on the confirm button reads as a bug.

---

## `description` reaches the app

`CatalogItemResponse.description` shipped with V116 («Q3 vs Q4 is not distinguishable by name») and
nothing rendered it. The row now shows it as one clamped line under the name, and offers an `(i)`
with the full text — enough to tell Q3 from Q3+ at a glance without opening anything.

The `(i)` sits **beside** the row, not inside it: `InfoPopover`'s trigger is a `<button>` and the row
is a `<button>`, and a button inside a button is invalid markup.

`api/types.ts` declares it `description?: string | null` — optional, per the house rule that
`non_null` serialization makes a nullable backend field *absent*, so it is read with `!= null`.
Nothing writes it: `CatalogItemRequest` deliberately has no such field (a PATCH omitting it would
null the text), so this is a read path only.

---

## One dialog, called from everywhere

The master asked for it in as many words: «було б взагалі ідеально мати один такий діалог і всюди де
треба його викликати». There were **two** near-identical copies and a third surface with no browse at
all.

| surface | before | now |
|---|---|---|
| estimate editor — «Додати позицію» | own `CatalogPicker` (~150 lines) | shared |
| template editor — add a position | own `CatalogPicker` (~155 lines) | shared |
| template editor — replace ONE position | the same copy, `single` mode | shared, `single` |
| act editor — «Додаткові роботи» | **type-ahead only**, no browse | shared, in a `Modal` |

−381 lines, +95. The tab strip above them («З каталогу» / «Вручну») was a third copy and is now
`features/catalog/AddPositionTabs.tsx`.

The component owns everything the callers used to each own separately: busy state, the error toast,
the success toast, clearing the basket. A caller supplies only `onPick(items)` — mapping catalog
items to *its* payload (an estimate line, a template item, an additional work) — plus four props for
the parts that genuinely differ:

- `disabledNames` — positions already present where the pick lands, greyed and untappable. Templates
  pass the bundle (two positions under one name merge on apply); the estimate passes nothing, because
  an estimate may legitimately carry the same position twice.
- `single` — a replacement picker for one position: a tap applies at once, no basket, no toast.
- `hint` — the estimate's «Кількість 1 — поправте в кошторисі». A template item has no quantity, so
  it passes none.
- `listHeightClass` — 40dvh in the estimate sheet, 30dvh where a form shares the sheet.

### The act editor gained a browse it never had

Additional (off-estimate) works could only be typed, with a type-ahead. That answers «як це
називалось?» but not «що я взагалі роблю на цьому об'єкті» — and the type-ahead never shows the trade
or the category. The `+ З каталогу` button opens the same picker in a `Modal`.

Two things about that surface are deliberately unlike the others: it writes to a **local draft list**
(the act editor is explicit-save, so `onPick` resolves immediately and nothing hits the server), and
it carries the catalog's `defaultPrice` into the row, because an additional work is billed. The
off-estimate warning (`acts.additionalWarn`, once per device) was extracted to `warnAboutAdditional`
so it fires whichever way the row is created — typed or picked.

---

## The one behaviour that changed for everyone

The two old pickers disagreed about **the order picks are handed over**, and nobody could have known:
the estimate one iterated the selection set (`[...selected]` — the order rows were *tapped*), the
template one filtered the catalog (`data.filter` — the order they are *stored*).

Unified on **catalog order**. Nothing on screen numbers the taps, so tap order is an arrangement the
master cannot see; and picking five positions across two categories now lands them grouped the way he
keeps them, instead of interleaved by whatever he happened to press first. Pinned by a test.

This is the only place the shared component changed what a surface did. Everything else was carried
across as it was, including the two callers' different confirm behaviour (the estimate sheet closes
after adding, the template editor stays open) — that lives in `onPick`, where it belongs.

---

## What was audited and deliberately NOT merged

- **`CatalogAutocomplete`** — the type-ahead inside `ItemForm` and inside an act's additional-work
  row. It is a different control answering a different question (complete a name I am already
  typing), not a browse. Untouched, and still present on both surfaces beside the new browse.
- **The «Вручну» tabs.** `ItemForm` (estimate) and `ManualForm` (templates) look alike and are not:
  an estimate line carries quantity, price, a room, a measurement link and a percent base; a template
  item is name + type + unit and nothing else. Only the tab *strip* was shared.
- **Template positions still show a price** in the picker even though a template item stores none —
  it is the master's own catalog price and reads as a guide (user decision: «лишити як є — це
  орієнтир»).
- **The type filter (Усі / Роботи / Матеріали)** existed only on the estimate picker. It is now on
  all of them by user decision («хай буде скрізь однаково»), not by accident of sharing.

---

## Mobile

Every row and folder header is `min-h-11` with full-width tap targets; the name wraps
(`break-words`), the description clamps (`truncate` inside a `min-w-0` cell), the price is
`whitespace-nowrap`; the list scrolls inside a `dvh`-capped box and the confirm button sits below it,
always reachable without scrolling the list. Trade chips scroll horizontally; the three type chips
fit 375 px with room to spare.

**Not verified in a live browser this round** — Chrome's content-script injection was down for the
whole session (screenshots timed out on `example.com` too, not only on our page), so the pass above is
a static one against the layout rules. Worth a look on the next visual round.

---

## Tests

`src/features/catalog/CatalogPicker.test.tsx` — 8 tests: folders first (12 positions / 2 categories →
2 headers, 0 rows; a tap opens 6 and leaves the other trade shut), a short catalog stays open, search
opens every matching folder, a folder collapsed while browsing cannot swallow a search hit, picks
arrive in catalog order not tap order, `disabledNames` greys a row and refuses the tap, `single`
applies straight away, `description` renders with exactly one `(i)`.

Full PWA gate green: `npm run lint` · `npx tsc -b` · `npm run typecheck:tests` · `npx vitest run`
(**770** tests) · `npx vite build`.
