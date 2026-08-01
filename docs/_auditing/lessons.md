# Lessons — everything the frontend programme learned the hard way

Extracted 2026-08-01 from `docs/audit/wave-reports.md` and `docs/audit/0-remediation-ledger.md` before
their deletion. Organised by theme, not by wave, because that is how a future session will need them.
Where a lesson produced a standing rule, the rule is stated in bold at the front.

This file is history, not current state — it describes what happened in the 2026-07 frontend
programme. Where it names a file, function or flag, verify against the code before relying on it.

**How this file grows.** Every later programme feeds it continuously, not just at close: a wave's
close-out (ledger Part 4b) and a pass's handoff both include a lessons harvest — any new misstep,
false positive, library trap or environment trap of durable value is **verified first** (reproduced,
or confirmed at the library source / running system — an unverified lesson is a rumour with a
heading) and then merged into the matching theme below, in the same commit as the work that found
it. Merge into existing themes; never append a per-wave dump at the end.

---

## 1. The audit itself is fallible — verify findings before acting

**Rule: a finding is a claim. Re-verify it at the current code before writing any fix, and treat every
replacement snippet in a report as untested code.** Roughly a fifth of the frontend findings were
wrong in some way. The catalogue, so the shapes are recognisable:

### Findings that inverted or evaporated

- **Two HIGH findings inverted by one backend read** (R3a-A1.1/A1.2): the audit demanded cache
  invalidation on the delete actions. The backend's soft delete never touches `spiele` — the
  endpoints do not even receive that collection. Applying the fix as written would have added dead
  invalidation and kept a false warning in two modals. Found by Wave 0 answering the question instead
  of trusting the report.
- **A HIGH row was a no-op** (R4-16.1): "~91 cards, ~13 modals mounted up front" — react-aria's
  `TabPanel` already returns `null` for unselected panels. Measured: 8 cards, 1 panel. The prescribed
  mount guard would have changed nothing. The derived "~22 overlay trees" in a sibling row was wrong
  for the same reason (real count ~11).
- **A config "fix" would have caused the bug it warned about** (R2-6.7): the report recommended
  replacing `js/ts.tsdk.path` with `typescript.tsdk`; the official docs give the former as current.
  R2 honestly flagged it could not verify — the honesty is what made the row cheap to close.
- **Findings with no reachable site** (R3b-S8.2 pagination clamp): nothing routes user input into
  `limit`, and the backend already bounds it. Closed won't-do rather than adding a clamp for a state
  that cannot occur.
- **Findings already fixed by earlier waves** (R4-18.2's hydration half, R4-18.5, R2-5.4's target,
  R1-13c/13d's targets): stale by the time their wave ran. Re-verification closed them in minutes;
  acting on the text would have "fixed" code that no longer exists.

### Replacement snippets that would have shipped defects verbatim

- **R2 §1.8's score parser contains the bug it fixes**: `":"` splits into two empty strings (length
  2), and `Number("")` is `0` — so the "fix" reports a 0:0 draw for garbage. Caught by writing the
  test before trusting the snippet.
- **R2 §5.9's icon-dictionary placement creates a module cycle** — the defect class the wave existed
  to remove.
- **R3b §S9.1's `'strict-dynamic'` CSP blocks every script on all 24 prerendered routes** — a
  build-time shell has no request and therefore no nonce. Measured: 17 of 43 script tags carried the
  token.
- **R3b §S5.1's `NODE_ENV === "production"` cookie gate refuses to boot the local stack**, which runs
  the production image over plain-HTTP localhost. Gate on the URL's own host instead.
- **R3b §S10.3's entrypoint validation dies with `ERR_MODULE_NOT_FOUND`** — the modules it needs are
  compiled into the server bundle and absent from the standalone image.
- **Three of R4's token names do not compile** (`--modal-max-h`, `--container-prose`, `--sidemenu-w`
  — wrong Tailwind namespaces), and §6.2 named a token a prior wave had renamed. From Wave 5a on, an
  unresolvable class fails the gate; before that it was a silent no-op.
- **R4 §2.1's fix nests a button inside a button** (`Dropdown.Trigger` already is one); §4.7's skip
  link uses the wrong brand token; §3.1's "focus moves for free" holds only for native validation,
  not server errors; §10.5's fix would have shrunk the public header and made its `<nav>` overflow;
  §7.3's `currentColor` premise was false and would have rendered near-black dots on green.
- **R3a §B4.5's lead fix is a no-op** — the parameter already admits the type; the real rule is that
  TypeScript infers index signatures for `type` aliases but not `interface`s.

### Systematic undercounting

Reports name the site they saw, not the blast radius: route-param casts were 4, not 2 (each file also
casts in `generateMetadata`); the flat-component move was 12 files, not 6 (the tree drifted between
audit and wave); the shell-breakpoint change was 9 edits in 6 files, not "12 in 4" — and missing the
two layouts would have stacked the sidebar above the content. **Grep for the pattern; never trust the
report's enumeration of sites.**

### The ledger can also be wrong about the report

R2-4.5's ledger row said "derive the type" while all three of its source sections said the opposite
(delete the Zod twin, keep the union). The NEW-T1 row prescribed a fix that had already been tested
and disproved. **Read the row and the section together; where they conflict, re-derive from code.**

---

## 2. What made the passes work — keep these

- **The coverage ledger, written first.** One row per check: what was grepped, raw occurrence count,
  finding count. It is what makes "zero occurrences" a verifiable claim instead of an unchecked one,
  and it is what a resumed session continues from.
- **Check-by-check traversal**, grep to a candidate set, then read candidates in full. File-by-file
  reading produces summaries, not findings.
- **Budget honesty** — completing checks in priority order and declaring the cut ones beats silently
  thinning all of them. Passes that cut checks said so and the ledger scheduled the remainder.
- **The nuance rule.** Findings that are plausibly deliberate get presented as decisions to confirm,
  not defects to rip out. This is what turned into the §9/ADR system — the single highest-value
  output of the programme, because it stops every future audit from re-litigating the same sixteen
  patterns.
- **Explicit boundaries with cite-don't-re-report.** Later passes read earlier reports and cite by
  section. Without this, the same defect gets four differently-worded findings and the ledger's
  overlap map becomes archaeology.
- **Already-correct lists.** Naming what is right (and near-misses that are not findings) prevents a
  future reader from "fixing" working code. Several were later load-bearing (R2 §1.10 protected the
  filter-params design from a NEW-SC6 "fix").
- **/clear between passes.** Observed directly: without it the model summarises instead of scans.

## 3. What the passes missed — and what covers the gap

Five passes, ~14k lines of report, and none of them found: `getSystemInfo` calling a route that does
not exist, the `FLGruppen` empty-group crash, the `HH:MM` 422, `FLSpielSchema` silently stripping
`saison_id`, `build_saisons_filter` matching nothing, the `Sidemenu` `useSearchParams()` shell
collapse, both `apiClient` header/timeout defects, or the duplicated backend `FLSpieltag`. All were
found by **doing adjacent work carefully** — convergence sweeps, final reviews, implementing a fix
and reading the surrounding code. Conclusions:

- A static audit finds what its lens names. **Cross-cutting convergence checks (two-sided contract
  comparison, mutation→invalidation maps, write-path→read-path tracing) find a different defect class
  than per-file inspection** — build them into passes as required tables, not prose.
- **The wave-level independent review is not optional.** It found shipped defects every single time
  it ran: the W4R series (a security regex whose anchor nothing tested, a PATCH that zeroed rents, a
  two-way branch over a three-way domain), Wave 7's eighteen findings (a mount guard applied to one
  of four call sites with its row already ticked `[x]` and a docblock asserting the opposite), Wave
  6's rounds 13–23. Its lens matters: **review the fixes as unreviewed code from a stranger**, not by
  re-checking the list that produced them — the second Wave 4 pass, run that way, found two
  regressions the first pass had introduced (an IDN-rejecting URL validator that would have 500'd
  `GET /teams` on one umlaut domain; a constraint justified by the write path alone when the model
  also validates every read).
- **"Every constraint rejects a bad value" is the wrong test bar.** The URL control's six rejection
  cases all passed with the load-bearing `^` anchor deleted. Test that the rule is _right_ (positive
  and negative baselines, and for regex controls: delete the anchor and watch a test fail).
- **Behavioural side channels evade response-body checks.** Wave 3 equalised the sign-in action's
  _return value_ for admin and non-admin addresses — and the browser's address bar stayed a perfect
  membership oracle, because the underlying `signIn` call _navigated_ differently per branch. Only
  Wave 6's fifth review round caught it. An enumeration/oracle check must compare the full
  observable behaviour — navigation, timing, status — not just the payload.

## 4. Verify against the installed library, not general knowledge

**Rule: before building on an assumption about a library, read its source in `node_modules` or
measure the running system.** The programme's costliest wrong turns were all plausible-sounding
library beliefs:

- react-stately normalises a `null` NumberField value to `NaN` (both render empty; only literal `0`
  shows "0").
- Tailwind v4's `scale-*` emits the standalone `scale` property, which **composes** with `transform`
  — `scale-100` cannot cancel a press-scale; `transform-none` can.
- HeroUI declares component CSS in an earlier `@layer` than utilities, so a plain utility wins at
  equal specificity — and its 71 focus rules also declare `outline-style: none`.
- react-aria: `TabPanel` returns `null` unselected; `Accordion.Panel` does not; `Dropdown.Trigger` /
  `Popover.Trigger` / `Tooltip.Trigger` all render (or wrap) a focusable button-like element, so
  putting a `<button>` inside any of them nests interactive content — the programme hit this trap
  **three separate times**; `isFocusVisible` is a **global** modality flag, so styling keyed off it
  fires at random; overlays light-dismiss on interaction, and a client-side navigation is not one;
  positioning against `document.body` adds `documentElement.scrollTop`, which is wrong inside any
  `position: fixed` overlay — never anchor a popover inside a fixed overlay.
- `dynamic({ ssr: false })` with no `loading` renders `null` — a click on the trigger looks dead
  until the chunk arrives.
- Next writes suggested `tsconfig` defaults for any **absent** key (presence check, not value check)
  — `allowJs` cannot be deleted, only declared `false`.
- Next keeps the previous page mounted in a hidden Activity tree; hidden trees still re-render on new
  props, and a react-aria collection that re-renders hidden drops its rows (NEW-T1). `element.click()`
  on a `<Link>` in the test harness performs a **hard** navigation, so a loop driven that way never
  exercises Activity trees at all.
- Pydantic: `model_dump(include=…)` names **fields, never aliases, and never raises** on a name that
  does not exist — a filter builder can silently match nothing (BE-8). Pydantic validates on the way
  **out** of Mongo, so a new constraint that existing data violates 500s the endpoint serving it —
  **run a read-only data audit before adding any backend constraint**, and check the right half of a
  join (the API's `FLTeam` is `teams` ⋈ `saison_teams`; the first data audit checked the wrong half
  and reported all 17 teams broken).
- `re` `pattern=` on a Pydantic field uses `re.search` — a missing `^` silently unanchors the whole
  control.

## 5. The gate — what it catches, what it cannot, and its own traps

- **`pnpm verify` was green while the built image was broken. Twice.** A module-scope env read that
  only fails in the builder stage, and `instrumentation.ts` at the repo root compiling fine but not
  being traced into `output: "standalone"` — which silently disabled the env gate _and all production
  error logging_. Hence `./scripts/verify.sh` builds both images and sanity-checks the output.
  `--quick` is not sufficient when touching `src/core/config.ts`, `src/core/auth.ts` or
  `src/instrumentation.ts`.
- **Run the script, never a hand-typed chain.** A hand-typed chain dropped the prettier link and
  shipped two mis-formatted files; any new check goes _inside_ `verify` so no session must be told
  about it.
- **The gate mutates the tree** (`prettier --write` runs first) — commit what it reformats, as its
  own commit when large.
- **Prettier's Tailwind plugin can corrupt conditional class strings**: a separating space written
  _inside_ a string literal (`"${cond ? " hidden" : ""}`… glued after format). Nothing in the gate
  sees it. The space belongs in the template literal; `no-concatenated-classes` catches only half the
  shapes.
- **Silent skips**: `pytest -q` hides what failed (`-ra --showlocals`); `parametrize` over an empty
  list _skips_ rather than fails (give discovery-driven tests a count floor); a bare
  `pytest.raises(ValidationError)` passes whatever went wrong (assert the failing field); `node
--test` collects any `test-*` file, including a tooling file, and reports it as a passing test.
- **Isolate mechanical mega-commits** (a formatter config change, a token repointing) with nothing
  else in them, or review dies.
- **What no gate can see**: RSC serialization rules (a Server Component passing a render prop to a
  Client Component throws only at request time on a dynamic route — **grep for render props before
  deleting a `"use client"`**), emitted-but-wrong class strings, manifest URLs, cache-tag wiring, and
  everything behind an auth wall.

## 6. Runtime verification — environment traps

- **The embedded browser pane, when hidden, does not composite.** `requestAnimationFrame` never
  fires; every hard load looks stuck on its loader with content in `display:none` divs; geometry
  reads 0; `:focus`/`:focus-visible` never match; the animation clock is frozen, so a transitioning
  property reads its start value (this manufactured a fake "disabled:opacity-50 not applying" bug and
  a fake React state-convergence bug). Trustworthy: client-side navigation, manually flushed reveals,
  reading compiled CSS, and driving a real headless browser over CDP. When screenshots time out, the
  pane is hidden — say what could not be verified rather than reasoning around it.
- **Theme checks need one page load per theme** (seed the storage key before scripts run) — flipping
  `data-theme` live produced stale readings, and emulating `prefers-color-scheme` does nothing when
  the app pins a default theme.
- **`/admin` is unreachable without a session and credentials are off-limits.** Runtime checks go
  through throwaway probe routes under `/dashboard` that replicate the shape, deleted before commit.
  Say plainly what this leaves unverified (the frontend programme's kept cache tags were never
  exercised at runtime — stated, not hidden).
- **The visual pass earns its keep**: screenshots of the production image in both themes caught a
  0×0-rendering footer regression that types, lint, build and tests all passed.
- Docker context cannot be probed the way the reports suggested (lazy per-step transfer) — build a
  probe image instead. A `grep` not scoped away from `.env` once matched a secret file; scope every
  search away from ignored paths _before_ running it.

## 7. Ledger discipline — how it broke, and the rules that fixed it

The ledger broke repeatedly in the frontend programme. Every failure mode and its countermeasure:

| Failure observed                                                                                                                                         | Rule                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Corrections appended below text that still said the old thing — self-contradiction hundreds of lines apart (Wave 3, four places)                         | **Revise in place, never append** (Part 4c). Log the change under "Revisions after first publication"                           |
| Closed rows grown into 600+-character narratives duplicating the report                                                                                  | Rows are **status + forward constraints + report link**, 150–600 chars; trim at close                                           |
| Stale numbers (test counts three gates old, two backend rows still "outstanding" after shipping)                                                         | The Part 4c sweep names numbers as the first thing to go stale — check gate output, counts, ranges every close                  |
| Rows filed in the wrong wave's table (`R3b-S9.1b` lived in Wave 5b while Wave 3 referred to it)                                                          | A row lives in the wave that owns it; move it when ownership moves                                                              |
| Per-wave `§` section lists drifted — 8 of 9 waves missing sections their own rows cite                                                                   | Section lists are **derived from the `§` column**; re-derive whenever a row is added, merged or moved                           |
| A stray blank line turned five rows into plain text; a scripted edit matched the wrong status cell and deleted two rows, an exit gate and a wave heading | **Never bulk-edit the ledger with pattern-matched scripts**; use line-scoped edits and diff against last-good before committing |
| Forward prompts still instructing a future session to ship an approach the wave had measured and rejected                                                | Part 4c check 5: the wave's own prompt entry and constraints written onto later rows must reflect final decisions               |
| A row ticked `[x]` while the work covered one of four call sites                                                                                         | Independent review re-checks ticked rows against the diff; a row closes only with its evidence                                  |

And the positive rules: **`[-]` won't-do with evidence and a reversal trigger is a first-class
result**, worth more than an overstated `[x]`. Every decision gets recorded in the same commit that
acts on it — but recording-as-you-go is necessary and not sufficient, because half a wave's substance
arrives from review _after_ the rows are written; the end-of-wave sweep is what keeps the document
true.

## 8. Wave mechanics — ordering, scope, and owner interaction

- **Dependency order is real**: guardrails before anything (their lint rules caught in-flight
  mistakes in four later waves); boundaries before extraction (extracting across a broken layer graph
  bakes the cycles into shared code); tokens before extraction (5b bakes the token layer into shared
  components); accessibility after extraction (or the sweep runs eight times); cleanup last.
- **The overlap map pays for itself** — one `ModalShell` extraction converted four multi-site sweeps
  into single-site fixes; one chip rewrite closed three findings.
- **Wave 0 first.** Five questions and five decisions, answered before code, inverted two findings,
  settled fix direction on three more, and produced the §9 ratified-decisions table that ended the
  false-positive treadmill.
- **Front-load owner decisions as one batch.** Contrast choices, user-visible changes, anything
  reopening a ratified decision, any row whose text says "owner". Discovering them one at a time
  mid-wave stalls the wave across sittings.
- **Visual divergence rule**: when deduplicating drifted copies, behavioural divergences are resolved
  explicitly; visual divergences default to _both sides become identical_ — keeping a difference
  needs the owner first, and the reason goes in the PR description.
- **Owner review rounds are where the truth arrives.** Wave 3: "every one of these was found by a
  question, not by the gate" — a reversal of the wave's largest decision, two controls that had
  silently never run. Wave 7 took three rounds on one flicker because the first two fixes addressed
  plausible causes instead of measured ones; the tell was that changing the parameter changed
  nothing ("if both durations look the same, duration is not the variable").
- **Coupled cross-repo changes ship in one PR** — `publish.sh` builds both images before pushing
  either, so there is no window where a new frontend meets an old backend.
- **File findings in the wave that will fix them, not the wave that found them.** And when a fix is
  reversed (React Compiler: enabled, measured at +40 KB gzipped on every page, removed same day),
  the reversal trigger goes on the row and the artifacts must be verified actually gone (the
  lockfile kept the compiler package until `node_modules` and the lockfile were rebuilt clean).

## 9. Report and prompt hygiene

- **Wave reports follow the seven-section template** (purpose in lay terms, changes by theme,
  decisions with reasoning, where the audit was wrong, verification with real output, discovered
  along the way, left undone) plus "Revisions after first publication". A report that lists only
  successes tells the next reader nothing the diff does not.
- **Honesty about non-verification**: every wave stated what it could not verify and why (admin
  behind auth, single-season data, hidden pane) instead of implying coverage. Several of those
  statements later routed a human check to the right place.
- **Prompts hardcode as little as possible.** Everything hardcoded in the frontend prompts drifted:
  file counts, line numbers ("around line 120"), stale paths (`PlayoffsView` had moved slices), a
  wrong provenance claim about a CSS utility that nearly put eight dead classes on an ignore list.
  State _where to look it up_, not the value.
- **Derive inventories, never enumerate them in the prompt.** The security pass hardcoded its
  `"use server"` module list; the Spiel write path moved slices within a week and only the "plus any
  others found" escape clause saved the check. A prompt states the grep that produces the list.
- **Cap a pass's report size by splitting the lens.** The UI-quality pass wrote a 329 KB report —
  the reason the ledger had to forbid loading whole reports. A lens producing ~18 checks across four
  themes is two passes, not one.
- **A pass must read the prior reports of its own programme** and cite rather than re-report — but
  only the sections it needs, never whole files.
