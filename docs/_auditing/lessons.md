# Lessons — the traps an audit programme runs into

Read this before running any phase.

| Section                                                                                                           | Read it when                                        |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [1 · Reports are claims](#1-an-audit-report-is-a-list-of-claims-not-a-list-of-facts)                              | Starting any wave — this is the one that costs most |
| [2 · What makes a pass work](#2-what-makes-a-pass-work--keep-these)                                               | Running or writing a pass                           |
| [3 · What a pass misses](#3-what-a-static-pass-misses-and-what-covers-the-gap)                                    | Deciding whether the programme's coverage is enough |
| [4 · Verify, don't recall](#4-verify-against-the-installed-library-and-the-live-platform-never-general-knowledge) | About to state how a library or platform behaves    |
| [5 · The gate](#5-the-gate--what-it-catches-what-it-cannot-and-its-own-traps)                                     | Closing out a wave                                  |
| [6 · Environment traps](#6-runtime-verification--environment-traps)                                               | Verifying anything at runtime                       |
| [7 · Ledger discipline](#7-ledger-discipline--the-failure-modes-and-their-rules)                                  | Editing the ledger                                  |
| [8 · Wave mechanics](#8-wave-mechanics--ordering-scope-and-owner-interaction)                                     | Planning waves or running one                       |
| [9 · Report and prompt hygiene](#9-report-and-prompt-hygiene)                                                     | Writing a report or a prompt                        |
| [10 · Stack-specific traps](#10-stack-specific-traps)                                                             | Working in this stack                               |

Sections 1 to 9 are surface-agnostic process rules. Section 10 holds stack-specific facts that are
easy to get wrong and cheap to check.

**How this file grows.** Every phase feeds it: a pass's handoff and a wave's close-out both include
a lessons harvest. A new misstep, false positive, library trap or environment trap of durable value
is **verified first** — reproduced, or confirmed at the library source or the running system, since
an unverified lesson is a rumour with a heading — and then merged into the matching section, in the
same commit as the work that found it. Merge into the existing sections; never append a per-run dump
at the end. Only one session edits this file at a time.

**How this file stays true.** A lesson is a durable rule. Anything that can change underneath it —
which checks a script runs today, which files trigger which gate, a library's current behaviour, a
version number — is **cited, never restated**, so this file cannot drift out of agreement with its
source. Two consequences when writing a lesson:

- State the failure mode and the rule it produced. Point at the source for the current mechanics:
  `scripts/README.md` and the scripts themselves for what the gate covers, `docs/_decisions/` for
  ratified decisions, the installed package for library behaviour.
- **Where this file names a file, function, flag or version, verify it against the source before
  relying on it.** A named example is an illustration of the rule, not a current-state claim.

---

## 1. An audit report is a list of claims, not a list of facts

**Rule: re-verify every finding against the current code before writing any fix, and treat every
replacement snippet in a report as untested code that has never been executed.**

A pass report is the output of one lens reading a tree at one moment. It is the best available
starting point and it is routinely wrong — expect a meaningful fraction of any report's findings to
be stale, miscounted, inverted, or accompanied by a fix that does not work. None of that makes the
report bad; acting on it unverified is what makes it expensive. Budget verification time into every
wave.

**Closing a finding `[-]` with evidence is a first-class result.** It is worth more than an
overstated `[x]`.

### The shapes to expect

- **Findings that invert on an answer.** A finding written from one surface can be the exact opposite
  of correct once the other surface, or the owner, is consulted. Applying such a fix as written adds
  dead code and preserves a false claim. This is why Wave 0 answers questions before any code is
  written.
- **Findings that are already fixed.** By the time a wave runs, earlier waves may have removed the
  code the finding describes. Re-verification closes these in minutes; acting on the text "fixes"
  code that no longer exists.
- **Findings with no reachable site.** A defensive fix for a state nothing can produce is not a fix.
  Trace the input path before adding a guard; close the row won't-do with the trace as evidence.
- **Findings that are no-ops because a library already handles it.** A cost claim ("N components
  mounted up front") is a measurement, and it must actually be measured. Library behaviour frequently
  makes the prescribed remedy change nothing.
- **Findings whose recommendation is contradicted by the official documentation.** A report that
  honestly flags "I could not verify this" is doing its job — that honesty is what makes the row
  cheap to close.

### Replacement snippets ship defects verbatim

Snippets in a report were written, not run. Observed classes, each of which would have shipped:

- **A parser containing the bug it claims to fix** — for example, splitting a delimiter-only string
  yields two empty strings, and `Number("")` is `0`, so a "validation fix" reports a valid `0:0`
  score for garbage input. Write the test before trusting the snippet.
- **A fix that creates the defect class the wave exists to remove** — such as placing a shared
  dictionary where it forms a module cycle.
- **A security tightening that breaks the build output** — a stricter CSP that requires a per-request
  nonce disables every script on prerendered routes, because a build-time shell has no request.
- **An environment gate that refuses to boot the local stack** — gating on `NODE_ENV === "production"`
  breaks a local stack that deliberately runs the production image over plain-HTTP localhost. Gate on
  the request's own host instead.
- **A runtime check that cannot resolve its imports** in a bundled or standalone image, where the
  modules it needs are compiled in rather than present as files.
- **Names that do not compile** — design tokens in the wrong namespace, or a token a previous wave
  renamed. Verify a token name compiles before prescribing it.
- **Markup that is invalid** — nesting an interactive element inside a library trigger that already
  renders one, or shrinking a container so a sibling overflows.
- **A premise that is simply false** — "focus moves for free" (true only for native validation, not
  server errors), or a colour inheriting from `currentColor` when it does not.

### Reports name the site they saw, not the blast radius

Enumerations in reports undercount systematically, because the pass found an instance and stopped.
The tree also drifts between the audit and the wave. **Grep for the pattern yourself; never trust a
report's list of sites.** Missing the extra sites is not a cosmetic shortfall — a change applied to
some call sites and not others can be worse than not applying it at all.

### The ledger can be wrong about the report

A ledger row and its source sections can prescribe opposite fixes, and a row can prescribe an
approach a later wave already tested and disproved. **Read the row and the section together; where
they conflict, re-derive from the code.**

---

## 2. What makes a pass work — keep these

- **The coverage ledger, written first.** One row per check: what was grepped, the raw occurrence
  count, the finding count. It is what makes "zero occurrences" a verifiable claim rather than an
  unchecked one, and it is what a resumed session continues from.
- **Check-by-check traversal.** Grep to a candidate set, then read the candidates in full.
  File-by-file reading produces summaries, not findings.
- **Budget honesty.** Complete checks at full depth in priority order and declare the ones you cut.
  Six checks done properly with four declared incomplete beats ten done shallowly — and the ledger
  can schedule the remainder.
- **The nuance rule.** A finding that is plausibly deliberate is presented as a decision to confirm,
  not a defect to rip out. This is the highest-value output a programme produces: the confirmed
  decisions become ADRs, which stop every future audit re-litigating the same patterns.
- **Explicit boundaries, and cite rather than re-report.** Later passes read earlier reports and cite
  them by section. Without this, one defect becomes four differently-worded findings and the ledger's
  overlap map turns into archaeology.
- **Already-correct lists.** Naming what is right — and near-misses that are _not_ findings, with a
  one-line reason — stops a future reader "fixing" working code. These entries later prevent real
  regressions.
- **A clean context per pass.** Carrying one pass's context into the next makes the model summarise
  instead of scan.

---

## 3. What a static pass misses, and what covers the gap

A static audit finds what its lens names. Defects consistently found _outside_ the passes — during
convergence sweeps, final reviews, and while implementing an unrelated fix — include: a client
calling a route that does not exist, a crash on an empty collection, a schema silently stripping a
field, a filter builder matching nothing, a hook above a Suspense boundary collapsing a route
group's shells, and duplicated model definitions across surfaces. What covers the gap:

- **Cross-cutting convergence checks find a different defect class than per-file inspection.**
  Two-sided contract comparison, mutation-to-invalidation maps, and write-path-to-read-path tracing
  belong in passes as **required tables**, not prose. A table forces every row to be filled;
  narrative lets a gap go unmentioned.
- **The wave-level independent review is not optional.** Reviewing the wave's own diff as unreviewed
  code from a stranger — rather than re-checking the list that produced it — reliably finds shipped
  defects, including regressions introduced by the wave's own earlier review round. The lens is what
  makes it work.
- **"Every constraint rejects a bad value" is the wrong test bar.** A set of rejection tests can all
  pass with a load-bearing part of the rule deleted. Test that the rule is _right_: positive and
  negative baselines, and for a pattern-based control, delete the anchor and confirm a test fails.
- **Behavioural side channels evade response-body checks.** Equalising an action's _return value_
  across a valid and an invalid principal leaves an oracle intact if the underlying call _navigates_
  differently per branch. An enumeration check must compare the full observable behaviour —
  navigation target, timing, status code — not just the payload.

---

## 4. Verify against the installed library and the live platform, never general knowledge

**Rule: before building on an assumption about a library, read its source in `node_modules` or the
installed package, or measure the running system.** The costliest wrong turns in a programme are
plausible-sounding library beliefs, not obvious mistakes. Section 10 lists the specific ones this
stack has produced.

**The same rule applies more sharply to hosting-platform behaviour.** Platform features (repository
settings, permission scopes, registry linking, security tooling availability) move faster than any
training data, and the checks take seconds: open the settings page, run the command, fetch the raw
file. **State platform behaviour only after checking it, or say plainly that it needs checking.** The
cost of guessing is not just a wrong answer — a guess written into documentation has to be corrected
later.

---

## 5. The gate — what it catches, what it cannot, and its own traps

**What the gate actually runs is defined by `scripts/verify.sh` and documented in
`scripts/README.md`. Read those for its current coverage; this section holds only the rules that
outlive any particular set of checks.**

- **A green local gate is not a green image.** Two classes have shipped past a green in-package
  verify: a module-scope environment read that only fails in the builder stage, and a file that
  compiles at the repository root but is not traced into `output: "standalone"` — which silently
  disabled an environment gate and all production error logging. This is why the repository's gate
  builds the images and sanity-checks their contents, and why an audit wave runs the full form
  unless it changed documentation only.
- **Run the script, never a hand-typed chain.** A hand-typed chain is a chain someone drops a link
  from; one dropped formatter step shipped mis-formatted files. **Any new check goes _inside_ the
  script**, so no session has to be told about it and no lesson has to name it.
- **The gate mutates the tree** — the formatter runs in write mode first. Commit what it reformats,
  as its own commit when the reformat is large, and **read the post-gate diff**: the formatter's
  Tailwind plugin can corrupt a conditional class string by gluing a separating space written inside
  a string literal. Nothing in the gate sees that.
- **Isolate mechanical mega-commits** — a formatter config change, a token repointing — with nothing
  else in them, or review dies in the noise.
- **Silent skips make a suite lie.** `pytest -q` hides what failed (use `-ra --showlocals`);
  `parametrize` over an empty list _skips_ rather than fails, so give any discovery-driven test a
  count floor; a bare `pytest.raises(ValidationError)` passes whatever went wrong, so assert the
  failing field; `node --test` collects any `test-*` file including tooling files and reports them as
  passing tests.
- **What no gate can see:** React Server Component serialization rules (a Server Component passing a
  render prop to a Client Component throws only at request time on a dynamic route — **grep for
  render props before deleting a `"use client"`**), emitted-but-wrong class strings, manifest URLs,
  cache-tag wiring, and everything behind an auth wall.

---

## 6. Runtime verification — environment traps

- **The embedded browser pane does not composite while hidden.** `requestAnimationFrame` never
  fires; hard loads look stuck on the loader with content in `display: none`; geometry reads 0;
  `:focus` and `:focus-visible` never match; the animation clock is frozen, so a transitioning
  property reads its start value. This manufactures convincing fake bugs. Trustworthy in that state:
  client-side navigation, manually flushed reveals, reading compiled CSS, and driving a real headless
  browser over CDP. **When screenshots time out, the pane is hidden — say what could not be verified
  rather than reasoning around it.**
- **Theme checks need one page load per theme.** Seed the storage key before scripts run. Flipping
  the theme attribute live gives stale readings, and emulating `prefers-color-scheme` does nothing
  when the app pins a default theme.
- **`/admin` is unreachable without a session, and credentials are off-limits.** Runtime checks go
  through throwaway probe routes under a public segment that replicate the shape, deleted before
  commit. State plainly what this leaves unverified rather than implying coverage.
- **A visual pass earns its keep.** Screenshots of the production image in both themes have caught a
  component rendering at 0×0 that types, lint, build and tests all passed.
- **Docker build context cannot be probed by watching transfer sizes** (transfer is lazy and
  per-step) — build a probe image instead.
- **Scope every search away from ignored paths before running it.** An unscoped grep has matched a
  secret file.

---

## 7. Ledger discipline — the failure modes and their rules

| Failure                                                                                                                                     | Rule                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Corrections appended below text that still said the old thing, leaving self-contradiction hundreds of lines apart                           | **Revise in place, never append.** Log the change under "Revisions after first publication"                                          |
| Closed rows grown into long narratives duplicating the report                                                                               | A row is **status + forward constraints + report link**, 150–600 characters. Trim at close                                           |
| Stale numbers — test counts several gates old, shipped rows still marked outstanding                                                        | The consistency sweep names numbers as the first thing to go stale: check gate output, counts and ranges every close                 |
| Rows filed in the wrong wave's table while another wave referred to them                                                                    | A row lives in the wave that owns it; move it when ownership moves                                                                   |
| Per-wave `§` section lists drifting until most waves were missing sections their own rows cite                                              | Section lists are **derived from the `§` column**; re-derive whenever a row is added, merged or moved                                |
| A stray blank line turning rows into plain text; a scripted edit matching the wrong cell and deleting rows, an exit gate and a wave heading | **Never bulk-edit the ledger with pattern-matched scripts.** Line-scoped edits only; diff against the last snapshot before moving on |
| Forward instructions still telling a future session to ship an approach the wave had measured and rejected                                  | The sweep checks that this wave's prompt entry and the constraints written onto later rows reflect the final decisions               |
| A row ticked `[x]` while the work covered one of four call sites                                                                            | Independent review re-checks ticked rows against the diff; a row closes only with its evidence                                       |

**Record every decision in the same commit that acts on it** — but recording as you go is necessary
and not sufficient, because a large share of a wave's substance arrives from review _after_ the rows
are written. The end-of-wave sweep is what keeps the document true.

---

## 8. Wave mechanics — ordering, scope, and owner interaction

- **Dependency order is real, and it is not severity order.** Guardrails first, because their lint
  rules catch in-flight mistakes in every later wave. Boundaries before extraction, or the extraction
  bakes existing cycles into shared code. Design tokens before extraction, for the same reason.
  Accessibility after extraction, or the sweep runs once per copy. Cleanup last.
- **The overlap map pays for itself.** One shared-shell extraction can convert several multi-site
  sweeps into single-site fixes, and one component rewrite can close several findings at once. Build
  the map before assigning waves, not after.
- **Wave 0 first.** A small number of answered questions, settled before any code, can invert
  findings, redirect fixes, and produce the ratified-decision table that ends the false-positive
  treadmill.
- **Front-load owner decisions as one batch** with measured options and a recommendation each:
  contrast and colour choices, user-visible changes, anything reopening a ratified decision, any row
  whose text names the owner. Discovering them one at a time mid-wave stalls the wave across
  sittings.
- **Visual divergence rule.** When deduplicating drifted copies, behavioural divergences are resolved
  explicitly; visual divergences default to _both sides become identical_. Keeping a difference needs
  the owner's agreement first, and the reason goes in the pull request description.
- **Owner review rounds are where the truth arrives.** They surface reversals of a wave's largest
  decisions and controls that had silently never run — things the gate cannot see. When a fix does
  not work, stop guessing at plausible causes and measure: **if changing the parameter changes
  nothing, that parameter is not the variable.**
- **Coupled cross-repository changes ship in one pull request.** The publish script builds both
  images before pushing either, so there is no window in which a new frontend meets an old backend.
- **File a finding in the wave that will fix it, not the wave that found it.**
- **When a fix is reversed, verify its artifacts are actually gone.** A removed dependency can
  survive in the lockfile until `node_modules` and the lockfile are rebuilt clean. Put the reversal
  trigger on the row.

---

## 9. Report and prompt hygiene

- **A wave report follows its template and is written for humans**: purpose in lay terms, changes by
  theme, decisions with reasoning, where the audit was wrong, verification with real output,
  discovered along the way, left undone, plus revisions after first publication. **A report that
  lists only successes tells the next reader nothing the diff does not.**
- **Be honest about non-verification.** State what could not be verified and why, instead of implying
  coverage. Those statements are what route a later human check to the right place.
- **Prompts hardcode as little as possible.** Everything hardcoded drifts: file counts, line numbers,
  paths, and claims about a library's behaviour. State _where to look it up_, not the value.
- **Derive inventories, never enumerate them in a prompt.** A hardcoded module list goes stale within
  weeks as code moves between slices. A prompt states the grep that produces the list.
- **Cap a pass's report size by splitting the lens.** A pass whose report is too large to load is a
  pass whose findings cannot be worked. A lens producing roughly eighteen checks across four themes
  is two passes, not one.
- **A pass reads the prior reports of its own programme and cites them** rather than re-reporting —
  but only the sections it needs, never whole files.

---

## 10. Stack-specific traps

Verifiable facts about this repository's stack that have each cost a wrong turn. Confirm at the
installed version before relying on any of them.

### Frontend

- **react-stately** normalises a `null` `NumberField` value to `NaN`. Both render empty; only a
  literal `0` shows "0".
- **Tailwind v4's `scale-*`** emits the standalone `scale` property, which _composes_ with
  `transform` — `scale-100` cannot cancel a press-scale, but `transform-none` can.
- **HeroUI** declares component CSS in an earlier `@layer` than utilities, so a plain utility wins at
  equal specificity. Its focus rules also declare `outline-style: none`.
- **react-aria**: `TabPanel` returns `null` when unselected, `Accordion.Panel` does not.
  `Dropdown.Trigger`, `Popover.Trigger` and `Tooltip.Trigger` each render or wrap a focusable
  button-like element, so putting a `<button>` inside one nests interactive content — this trap
  recurs, check for it every time. `isFocusVisible` is a **global** modality flag, so styling keyed
  off it fires at seemingly random moments. Overlays light-dismiss on interaction, and a client-side
  navigation is not one. Positioning against `document.body` adds `documentElement.scrollTop`, which
  is wrong inside any `position: fixed` overlay — never anchor a popover inside a fixed overlay.
- **`dynamic({ ssr: false })` with no `loading`** renders `null`, so a click on the trigger looks
  dead until the chunk arrives.
- **Next writes suggested `tsconfig` defaults for any absent key** — a presence check, not a value
  check. `allowJs` cannot be deleted, only declared `false`.
- **Next keeps the previous page mounted in a hidden Activity tree.** Hidden trees still re-render on
  new props, and a react-aria collection that re-renders while hidden drops its rows. In a test
  harness, `element.click()` on a `<Link>` performs a **hard** navigation, so a loop driven that way
  never exercises Activity trees at all — drive `router.push` instead.

### Backend

- **Pydantic `model_dump(include=…)`** names **fields, never aliases**, and **never raises** on a
  name that does not exist — so a filter builder can silently match nothing.
- **Pydantic validates on the way _out_ of Mongo**, so a new constraint that existing data violates
  produces a 500 on the endpoint serving that data. **Run a read-only data audit before adding any
  backend constraint** — and audit the correct half of a join, since a model served from a join can
  look entirely broken when the wrong collection is checked.
- **A `re` `pattern=` on a Pydantic field uses `re.search`**, so a missing `^` silently unanchors the
  whole control.

### Ops and environment

- **Docker ignore patterns fail silently.** A dead pattern looks identical to a live one, so ignore
  files can accumulate patterns matching nothing while host build artifacts ship into Linux images.
  Spot-check by building a probe image.
- **A CI action version that never existed** fails only when CI runs. Check the raw `action.yml` URL;
  release pages summarise unreliably.
