---
name: open-questions
description: Use at the start of every new iteration, step, or coding chunk before writing any production code. Read docs/open-questions.md, summarize every OPEN and IN_PROGRESS item, and classify each one against the work about to begin (in scope / adjacent / out of scope). Also use when the user signals a new chunk ("next step", "let's start", "продовжуємо", "наступна ітерація", "новий крок", a fresh feature prompt). Skip when the work is a tiny bug fix that touches one file.
---

# Open-questions review

You are about to start (or just started) a new iteration. Walk through
the open-questions log so nothing important is silently skipped.

## Mobile-first — priority #1 (verify on EVERY change, incl. tiny fixes)

**~95% of masters use the PWA on a phone.** Mobile is the primary target, not an
afterthought — this applies to every iteration AND every small fix, above the
"skip for tiny fixes" rule.

- Design every UI/UX change for a **narrow phone viewport first** (≈375px), then
  let it scale up — never the reverse.
- Before finishing UI work, **verify the mobile layout**: Browser pane with
  `resize_window` preset `mobile` (375×812). Check tap targets, no horizontal
  overflow, readable text, thumb-reachable actions, modals/sheets that fit. Prefer
  bottom sheets / full-width controls over desktop-style dialogs.
- If a change can't be mobile-verified in the moment, say so explicitly rather than
  silently assuming desktop is enough.

## Steps

1. **Read** `docs/open-questions.md` in full.

2. **Summarize** every item whose status is `OPEN` or `IN_PROGRESS`.
   Skip `DEFERRED` and `RESOLVED` unless the user explicitly asks for
   them. Group output by the section the item lives in (Architecture &
   operations / Security / Business logic / Features pipeline / Testing
   & quality). For each item show: title, one-line context, and current
   status.

3. **Classify** each `OPEN` item against the iteration the user just
   described (or, if not yet stated, the most recently agreed scope).
   Use exactly three buckets:

   - **In scope** — should be addressed in this iteration
   - **Adjacent** — touches the same files / domain, worth keeping in
     mind while writing, even if not the headline goal
   - **Out of scope** — leave as is

   Be honest: most items will be "Out of scope" on any given step. Don't
   inflate scope to look thorough.

4. **Ask** the user:
   - Do they want to **promote** any `OPEN` item to `IN_PROGRESS` for
     this iteration?
   - Has a new open question come up that should be **added**?
   - Is there anything to **resolve** from earlier work (status →
     `RESOLVED` + one-line summary in place, do not delete the item)?

5. **Apply** the user's answers as inline edits to
   `docs/open-questions.md`. Preserve the existing per-item shape
   (Status / Since / Context / Notes / Resolution). Don't rewrite the
   whole file — surgical edits only.

## Rules

- **Do not invent items.** Only echo what's already in the file, plus
  what the user adds by hand.
- **Status transitions are explicit** — never silently change a status
  without the user's word. If you think something should change, say so
  and wait.
- **Preserve history.** Resolved items stay in the file with their
  resolution line; don't move them to a separate file or delete them.
- **Be concise.** This routine is a lightweight checklist, not a
  re-planning session. If the answer for every item is "out of scope",
  the whole pass should fit in a short message.
- **Keep e2e in mind.** After each fix or change, consider to update the tests or add new ones.
  If the user says "next step" or similar, it's a good time to check if any existing `OPEN` item
  is now `IN_PROGRESS` and should be covered by a test, or if a new test should be added for a
  newly promoted item. Also check if previously done steps or fixed all are covered by tests, and if not,
  suggest adding them to the user. It's important to run them before each commit or push to not break the build.

## Project docs to read & reconcile every iteration

Two cross-repo docs live one directory up in `C:\Work` — shared by both
`majstr-backend` and `majstr-pwa`, not inside this repo:

- **`C:\Work\SPEC.md`** — product spec + roadmap (steps, chunks, statuses).
- **`C:\Work\PROMPTS.md`** — running log of the task prompts / definitions.

Plus, inside this repo:

- **`CLAUDE.md`** — keep its commands, conventions and paths current.

Read them at the start of an iteration for context, and **update them when work
lands** so they reflect reality:
- tick SPEC chunk boxes and move step statuses ⏳ → 🔄 → ✅;
- keep the `PROMPTS.md` TOC + heading statuses matching SPEC;
- refresh `CLAUDE.md` if commands/paths/conventions changed.

Surgical edits only — the user owns these files' overall shape; don't
restructure or rewrite them.

## Subagents — pre-approved for analysis

The user has **standing approval** to spawn subagents (the Agent tool) for
read-only analysis / exploration when it genuinely helps — e.g. fanning out
across the sibling `C:\Work\majstr-backend` repo to map a contract, or
sweeping many files. **Don't ask each time.** Keep it proportionate: for a
couple of targeted reads, just read inline (cheaper); reach for an
`Explore`/`general-purpose` subagent when the search is broad or spans many
locations. Implementation and edits stay in the main thread unless the user
says otherwise.
