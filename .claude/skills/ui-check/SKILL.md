---
name: ui-check
description: Before calling ANY visible PWA change done — a new control, a moved button, a sheet, a text — look at it on a 375 px phone screen with the backend mocked, and check it against the house UI rules. Use on every UI change, however small.
---

# UI check — look before you say «готово»

~95 % of masters use Majstr on a phone. A change that reads fine in the code can be a broken row on
the screen: a label cut to «Одиниц», a control the width of the page, two big buttons where one
would do. The owner has caught each of these by eye — they are cheaper to catch here.

## 1. Look at it

1. Vite must be running on `:5173` (`npm run dev`); the backend need NOT be.
2. Copy `shot-harness.mjs` (next to this file) to the scratchpad. Fill in `routes` with the exact
   API paths the screen calls and `steps` with what to open, tap and photograph.
3. From `C:/Work/majstr-pwa`: `node <copy>.mjs <scratchpad-dir>`. It prints `{overflow, errors}`.
4. **Read every screenshot.** Then look again after one real interaction (pick, add, close) —
   most problems show up in the second state, not the first.

If a screenshot shows something else entirely (a consent sheet, «Каталог оновлено», the splash),
the mock is incomplete — fix the mock, do not skip the look.

## 2. House rules (what the owner asked for, 2026-11-20)

- **Fewer taps.** An action that finishes the task takes you back: «Додати» in a picker closes the
  picker. No «Готово» button whose only job is to close something that could close itself.
- **One primary button per screen state.** Never two full-width buttons stacked at the bottom.
- **A small answer gets a small control.** A unit, a yes/no, a short choice: a compact control
  sized to its text, beside or under its label — not a full-width form field.
- **Proportion.** Text in one block shares one scale; a control is not visibly bigger than the
  text it belongs to. (`<select>`/`<input>` stay 16 px — smaller and iOS zooms on focus — so bring
  the label up to `text-sm` rather than the control down.)
- **A place to work is the whole screen.** A catalog, a picker, anything you scroll and search:
  its own full-screen sheet (`<Modal fill>`), not half a screen shared with something else.
- **Empty is quiet.** «Nothing here yet» is one muted line, not an icon + title + paragraph that
  pushes the real content off the screen.
- **Nothing clipped, nothing overflowing.** No cut-off label, `overflow:false`, rounded frames
  clip their rows (`overflow-hidden`).
- **Ukrainian plurals.** `{{count}}` next to a noun needs `_one/_few/_many/_other` keys —
  «Додати 1 позицію», never «1 позицій».
- **One message per action.** If a shared component already toasts, the caller does not toast too.

## 3. Then report

Say what you looked at («screenshot at 375 px: …») and what you fixed because of it. If you
could not look (no Vite, a flow the mock cannot reach), say so plainly — never call it done unseen.
