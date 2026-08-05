# Iteration — menus that drop from what you pressed, and names you can read

PWA `1.0.0 → 1.2.4`. Backend: one field (`EstimateSummary.duplicatedFromId`).

A run of phone-first UI corrections. None of them changed what the app does; all of them changed
whether a master could use it with one thumb.

---

## Action menus drop from the button

Every row menu was a **centred dialog**, and the dialog had to repeat the row's name in its title —
which is the tell. A menu in the middle of the screen has lost the one thing a row menu knows: WHICH
row it belongs to. On a list of six «Кошторис від 1 серпня» the master still had to trust that he had
tapped the right ⋮.

`components/ActionMenu.tsx` replaces three of them:

| where | was | now |
|---|---|---|
| ⋮ on an estimate row | dialog titled with the estimate name | menu from the button |
| ⋯ on an object card | dialog «Посилання на чат» holding one button | menu: «Скопіювати посилання» + the privacy line |
| 🔔 in the header | dialog listing objects | panel from the bell, capped height, scrolls |

Copying a chat link was three taps — ⋯, read the dialog, press — and is now two, because the action
**is** the menu line.

**The panel is portalled to `document.body`, and that is load-bearing.** As an ordinary
absolutely-positioned child it was clipped the moment a row sat inside a rounded card: the
dashboard's «Останні об'єкти» box has `overflow-hidden`, so the menu came out sliced with its label
cut mid-word. No z-index fixes that — clipping is not stacking. A portal leaves the clipping
ancestor entirely, which is why the position is measured from the trigger instead of inherited: the
panel flips up when there is no room below, clamps to the viewport, and re-places on scroll
(capture, because the list that scrolls is usually an inner element).

`ActionMenu.test.tsx` asserts the DOM relationship — the item is NOT inside the clipping card — for
the same reason the neighbouring test asserts the ⋯ is a SIBLING of the card's navigation button: a
CSS class would look correct while being removed.

**What was NOT converted, and why.** Forms (edit item, room, client, expense, deposit), import
wizards, confirms and consents stay centred dialogs. They are not menus — they hold fields, or a
yes/no decision.

---

## Long names wrap instead of truncating

Object and estimate names were truncated with an ellipsis in four places. What distinguishes
«Квартира на Зубрівській» from «Квартира на Зеленій», or «Зведений кошторис» from «Зведений кошторис
+15%», sits at the **end** — exactly what the ellipsis eats first on a 375 px screen. The address
line was worse: cut to «вул. С. Б…» it identifies nothing.

Fixed in the object card, the estimate list row, and the editor header. `break-words` guards against
a single unbroken word; the card is top-aligned so the total and badge stay on the first line.

---

## Dragging a whole category actually works now

A master reported that categories «то тягнуться, то ні, то просто пропадають», and were practically
undraggable on a phone. Three independent causes:

1. **The drop was usually discarded.** A section's droppable area is its whole block — heading plus
   every line — so on release the thing under the pointer is nearly always someone's *line*.
   `resolveDrag` looked for a section, found none, and threw the whole drag away. A line identifies
   its section perfectly well, so it now resolves through it. (Verified by reverting just that line:
   the new test fails, then passes.)
2. **Collision detection was competing with dozens of lines.** `closestCenter` counted every line as
   a candidate while a section's centre sits buried inside its own block. Dragging a section now
   considers only sections, and by **corners** — with `closestCenter` between blocks of very
   different heights, a short category had to be dragged past the MIDDLE of a thirty-line one.
3. **The grip was 28×20 px.** A line's grip is the full height of its card; a section's was `h-5`.
   Now 44 px, which also matches the height the category checkbox already uses in selection mode, so
   the header stopped changing height between modes.

---

## Smaller things in the same run

- **The FAB menu dims the page behind it.** The pills are white over a list of white cards and read
  at the same weight; recolouring them would have been fighting for attention rather than removing
  the competition. The full-screen tap-catcher already existed and already swallowed every tap —
  the scrim just makes that visible.
- **The offline banner stopped covering the back arrow** — `fixed` → `sticky`, so it occupies layout
  space instead of floating over it.
- **The FAB moved from `bottom-32` to `bottom-20`**, out of the messages card.
- **Position numbers** («1.», «2.» …) run through the whole estimate, in their own gutter column
  sized for two digits. A master asked for them to count positions against a list made on site, so
  the last number on screen has to equal the total — per-category numbering answers nothing.
- **The bulk-selection bar** is sticky inside the list column rather than fixed to the viewport, so
  it is the width of a position by construction, and it clears the mobile bottom nav.

---

## Gate

`npm run build` + `npx vitest run` (450 tests) + `npx eslint .` + `npm run typecheck:tests`, green
at 1.2.4.
