# Lessons — the traps an audit programme runs into

Read this before running any phase. Every lesson is a **rule**, with what ignoring it costs, and the
**instances** that produced it.

| Section                                                                                 | Read it when                                        |
| --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [1 · Findings are claims](#1-re-verify-every-finding-before-writing-any-fix)            | Starting any wave — this is the one that costs most |
| [3 · What a lens misses](#3-cover-what-a-static-lens-cannot-see)                        | Deciding whether the programme's coverage is enough |
| [4 · Verify, do not recall](#4-verify-a-library-or-platform-claim-at-its-source)        | About to state how a library or platform behaves    |
| [5 · The gate](#5-treat-a-green-gate-as-evidence-and-never-as-proof)                    | Closing out a wave                                  |
| [6 · Environment traps](#6-establish-the-environment-before-trusting-a-runtime-reading) | Verifying anything at runtime                       |
| [7 · Ledger discipline](#7-keep-the-ledger-true-as-the-work-moves)                      | Editing the ledger                                  |
| [8 · Wave mechanics](#8-order-waves-by-dependency-and-never-by-severity)                | Planning waves or running one                       |
| [9 · Report hygiene](#9-write-a-report-a-stranger-can-act-on)                           | Writing a wave report                               |
| [10 · Stack-specific traps](#10-confirm-a-stack-fact-at-the-installed-version)          | Working in this stack                               |

**Editing this file.** Verify a new lesson — reproduce it, or confirm it at the library source or the
running system — then merge it into the matching section, in the same commit as the work that found
it. Never append a per-run dump at the end. Only one session edits this file at a time.

**Cite what can move; restate nothing.** A lesson points at its source — `scripts/verify.sh` and
`docs/ops/spec.md` §1.6 for the gate, `.claude/CLAUDE.md` §7 and the `.claude/rules/` files it
indexes for ratified decisions, the installed
package for library behaviour. A named example illustrates the rule and is not a current-state claim;
confirm any file, function, flag or version there before relying on it.

---

## 1. Re-verify every finding before writing any fix

**Rule:** a pass report is one lens reading one tree at one moment. Re-verify each finding against
the current code before planning anything, grep the pattern yourself instead of trusting the report's
list of sites, and treat every replacement snippet as untested code. Closing a finding `[-]` with
evidence is worth more than an overstated `[x]`. Skipping this ships a fix for code that is already
gone, a change applied to some call sites and not others — which can be worse than not applying it at
all — or a snippet's own defect, verbatim.

**Instances**

- **A finding inverts on an answer** — written from one surface, it can be the exact opposite of
  correct once the other surface, or I, am consulted; Wave 0 exists for this.
- **A finding has nothing to fix** — the code was removed by an earlier wave, no input path reaches
  the state it defends against, or a library already handles it. A cost claim ("N components mounted
  up front") is a measurement and has to be measured.
- **A recommendation is contradicted by the official documentation.**
- **A snippet contains the bug it claims to fix.** Splitting a delimiter-only string yields two empty
  strings and `Number("")` is `0`, so a "validation fix" reports a valid `0:0` score for garbage
  input. Write the test before trusting the snippet.
- **A snippet creates the defect class the wave exists to remove** — a shared dictionary placed where
  it forms a module cycle.
- **A security or configuration fix verified only by reasoning is routinely unshippable.** Three
  shapes so far: a per-request CSP nonce disables every script on prerendered routes, because a
  build-time shell has no request; a `NODE_ENV === "production"` gate refuses the local stack that
  deliberately runs the production image over plain-HTTP localhost (gate on the request's own host
  instead); and a runtime check cannot resolve its imports in a bundled or standalone image, where
  the modules it needs are compiled in rather than present as files.
- **A prescribed name does not compile** — a design token in the wrong namespace, or one an earlier
  wave renamed.
- **Prescribed markup is invalid** — an interactive element nested inside a library trigger that
  already renders one, or a container shrunk until a sibling overflows.
- **A premise is simply false** — "focus moves for free", which holds for native validation and not
  for server errors, or a colour inheriting from `currentColor` where it does not.
- **The ledger row and its source section prescribe opposite fixes**, or the row prescribes an
  approach a later wave already disproved. Read both, and where they conflict re-derive from the code.
- **A control resolves, succeeds, and is wrong.** A guard matching `git` never sees `git.exe`; a
  helper handing `mktemp -d`'s MSYS path to a Windows binary dies after its work is half done; a
  strict check whose comparison window is empty passes everything. Nothing errors in any of them, so
  each is found only by constructing the input that should fail.

---

## 3. Cover what a static lens cannot see

**Rule:** a static pass finds what its lens names, so whole defect classes fall between lenses. Carry
cross-cutting convergence checks as **required tables** rather than prose, run the wave-level
independent review as its own phase, and test that a control is right rather than that it rejects a
bad value. Otherwise those defects surface during unrelated work instead — a client calling a route
that does not exist, a crash on an empty collection, a schema silently stripping a field, a filter
builder matching nothing, a hook above a Suspense boundary collapsing a route group's shells.

**Instances**

- **A convergence check finds a different class than per-file inspection.** Two-sided contract
  comparison, mutation-to-invalidation maps and write-path-to-read-path tracing each belong in a
  required table: a table forces every row to be filled, and narrative lets a gap go unmentioned.
- **The wave-level independent review is not optional.** Reviewing the wave's own diff as unreviewed
  code from a stranger — rather than re-checking the list that produced it — finds shipped defects,
  including regressions introduced by the wave's own earlier review round.
- **A set of rejection tests can all pass with a load-bearing part of the rule deleted.** Use
  positive and negative baselines, and for a pattern-based control delete the anchor and confirm a
  test fails.
- **A behavioural side channel evades a response-body check.** Equalising an action's return value
  across a valid and an invalid principal leaves the oracle intact if the underlying call navigates
  differently per branch. Compare the full observable behaviour: navigation target, timing, status
  code.

---

## 4. Verify a library or platform claim at its source

**Rule:** a plausible-sounding belief about an installed library or a hosting platform reads exactly
like a checked fact, and these are the costliest wrong turns a programme takes. Read the installed
package in `node_modules` or the installed Python distribution, or measure the running system, before
building on any assumption about it. For a platform — repository settings, permission scopes,
registry linking, security tooling — open the settings page, run the command, or fetch the raw file.
Where you did not check, say so plainly. The beliefs this repository has already paid for are §10.

---

## 5. Treat a green gate as evidence and never as proof

**Rule:** the gate proves what it runs, and its coverage is narrower than "it passed" sounds. Run the
full form unless the wave changed documentation only, keep a mechanical mega-commit — a formatter
config change, a token repointing — in a commit with nothing else in it, and make every suite fail
loudly rather than skip quietly. Otherwise a defect class the gate cannot see ships in an image it
reported green.

**Instances**

- **A green local gate is not a green image.** A module-scope environment read fails only in the
  builder stage, and a file that compiles at the repository root may not be traced into
  `output: "standalone"` — which silently disables an environment gate and all production error
  logging.
- **A silent skip makes a suite lie.** `pytest -q` hides what failed, so use `-ra --showlocals`;
  `parametrize` over an empty list skips rather than fails, so give a discovery-driven test a count
  floor; a bare `pytest.raises(ValidationError)` passes whatever went wrong, so assert the failing
  field; `node --test` collects any `test-*` file including tooling files and reports them as passing
  tests.
- **A gate over an uncommitted tree has checked nothing that is not tracked, and a gate that stops at
  its first failing scope understates the branch.** Citations resolve against tracked files, so a new
  file's breaches appear only once it is committed; and the scopes after the failing one never run,
  so a single reported finding can hide a second failing scope entirely.
- **No gate sees these**: React Server Component serialization rules (`.claude/rules/frontend.md`'s
  render-prop trap, which throws only at request time on a dynamic route), emitted-but-wrong class
  strings, manifest URLs, cache-tag wiring, and everything behind an auth wall.

---

## 6. Establish the environment before trusting a runtime reading

**Rule:** the verification environment manufactures convincing fake bugs and hides real ones, so
confirm the pane is compositing, the theme was seeded before scripts ran, and the route is reachable,
before reading anything out of it. Where a check could not run, state what is unverified rather than
reasoning around it — the alternative is hours chasing a defect the environment invented, or an
implied claim of coverage over a route nothing exercised.

**Instances**

- **The embedded browser pane does not composite while hidden.** `requestAnimationFrame` never fires;
  hard loads look stuck on the loader with content in `display: none`; geometry reads 0; `:focus` and
  `:focus-visible` never match; the animation clock is frozen, so a transitioning property reads its
  start value. Trustworthy in that state: client-side navigation, manually flushed reveals, reading
  compiled CSS, and driving a real headless browser over CDP. **When screenshots time out, the pane
  is hidden.**
- **A theme check needs one page load per theme.** Seed the storage key before scripts run: flipping
  the theme attribute live gives stale readings, and emulating `prefers-color-scheme` does nothing
  where the app pins a default theme.
- **`/admin` is unreachable without a session, and credentials are off-limits.** Runtime checks go
  through throwaway probe routes under a public segment that replicate the shape, deleted before
  commit. State plainly what this leaves unverified.
- **A visual pass earns its keep.** Screenshots of the production image in both themes have caught a
  component rendering at 0×0 that types, lint, build and tests all passed.
- **Docker build context cannot be probed by watching transfer sizes**, which are lazy and per-step.
  Build a probe image instead.
- **Scope every search away from ignored paths before running it.** An unscoped grep has matched a
  secret file.
- **A transcript is not a liveness signal; a deliverable is.** A completion notification arrives only
  for an agent that finishes, so an agent that stopped is indistinguishable from a slow one until its
  own output is checked. Read the deliverable file and the agent's scratch prefix before assuming the
  work needs redoing — the transcript and the tree fail independently.

---

## 7. Keep the ledger true as the work moves

**Rule:** the ledger is the only artifact that survives a context reset, and it drifts from the work
faster than anything else in the programme, so run the consistency sweep at every close. Recording as
you go is necessary and not sufficient, because a large share of a wave's substance arrives from
review **after** the rows are written.

**Instances**

| Failure                                                                                                                                     | Rule                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Corrections appended below text that still said the old thing, leaving self-contradiction hundreds of lines apart                           | **Revise in place, never append.** Log the change under "Revisions after first publication"                                          |
| Closed rows grown into long narratives duplicating the report                                                                               | A row is **status + forward constraints + report link**, at the size [`ledger-template.md`](ledger-template.md) sets. Trim at close  |
| Stale numbers — test counts several gates old, shipped rows still marked outstanding                                                        | The consistency sweep names numbers as the first thing to go stale: check gate output, counts and ranges every close                 |
| Rows filed in the wrong wave's table while another wave referred to them                                                                    | A row lives in the wave that will fix it, not the wave that found it; move it when ownership moves                                   |
| Per-wave `§` section lists drifting until most waves were missing sections their own rows cite                                              | Section lists are **derived from the `§` column**; re-derive whenever a row is added, merged or moved                                |
| A stray blank line turning rows into plain text; a scripted edit matching the wrong cell and deleting rows, an exit gate and a wave heading | **Never bulk-edit the ledger with pattern-matched scripts.** Line-scoped edits only; diff against the last snapshot before moving on |
| Forward instructions still telling a future session to ship an approach the wave had measured and rejected                                  | The sweep checks that this wave's prompt entry and the constraints written onto later rows reflect the final decisions               |
| A row ticked `[x]` while the work covered one of four call sites                                                                            | Independent review re-checks ticked rows against the diff; a row closes only with its evidence                                       |

---

## 8. Order waves by dependency and never by severity

**Rule:** severity order reads like priority order and produces waves that undo each other. Guardrails
first, because their rules catch in-flight mistakes in every later wave; boundaries and design tokens
before extraction; accessibility after extraction; performance late; cleanup last. Ordered by
severity instead, extraction bakes existing cycles into shared code, an accessibility sweep runs once
per copy, and a guardrail landing in the last wave catches nothing. When a fix does not work, measure
instead of trying plausible causes — **if changing the parameter changes nothing, that parameter is
not the variable.**

**Instances**

- **My review rounds are where the truth arrives.** They surface reversals of a wave's largest
  decisions, and controls that silently never run — things the gate cannot see.
- **Coupled cross-repository changes ship in one pull request.** The publish script builds both
  images before pushing either, so no window exists in which a new frontend meets an old backend.
- **When a fix is reversed, verify its artifacts are actually gone.** A removed dependency can
  survive in the lockfile until `node_modules` and the lockfile are rebuilt clean. Put the reversal
  trigger on the row.

---

## 9. Write a report a stranger can act on

**Rule:** a report written from inside the session reads as complete to its author and as a list of
successes to everyone else. A wave report carries, in order: purpose in lay terms · changes by
theme · decisions with their reasoning · where the audit was wrong · verification with real output ·
discovered along the way · left undone · revisions after first publication. State what could not be
verified and why, rather than implying coverage.

**Instances**

- **A pass whose report cannot be loaded is a pass whose findings cannot be worked.** Where a report
  outgrows what a wave session can open a section of, split the lens rather than compress the
  findings.

---

## 10. Confirm a stack fact at the installed version

**Rule:** each fact below has cost a wrong turn, and each reads like general knowledge. Confirm it at
the installed version before relying on it.

**Frontend**

- **react-stately** normalises a `null` `NumberField` value to `NaN`. Both render empty; only a
  literal `0` shows "0".
- **Tailwind's `scale-*`** emits the standalone `scale` property, which _composes_ with `transform` —
  `scale-100` cannot cancel a press-scale, but `transform-none` can.
- **HeroUI** declares component CSS in an earlier `@layer` than utilities, so a plain utility wins at
  equal specificity. Its focus rules also declare `outline-style: none`.
- **react-aria**: `TabPanel` returns `null` when unselected and `Accordion.Panel` does not.
  `Dropdown.Trigger`, `Popover.Trigger` and `Tooltip.Trigger` each render or wrap a focusable
  button-like element, so putting a `<button>` inside one nests interactive content — check for this
  every time. `isFocusVisible` is a **global** modality flag, so styling keyed off it fires at
  seemingly random moments. Overlays light-dismiss on interaction, and a client-side navigation is
  not one. Anything making `<html>` or `<body>` a containing block opens every top-placed overlay a
  whole scroll height low (`docs/frontend/spec.md :: I29`).
- **`dynamic({ ssr: false })` with no `loading`** renders `null`, so a click on the trigger looks dead
  until the chunk arrives.
- **Next writes suggested `tsconfig` defaults for any absent key** — a presence check, not a value
  check. `allowJs` cannot be deleted, only declared `false`.
- **Next keeps the previous page mounted in a hidden Activity tree.** Hidden trees still re-render on
  new props, and a react-aria collection that re-renders while hidden drops its rows. React destroys
  a hidden subtree's Effects and re-creates them on the way back, so an effect watching the pathname
  never sees the navigation that hid it — a page's own overlay closes as its link navigates or not at
  all. In a test harness, `element.click()` on a `<Link>` performs a **hard** navigation, so a loop
  driven that way never exercises Activity trees at all — drive `router.push` instead.

**Backend**

- **Pydantic `model_dump(include=…)`** names **fields, never aliases**, and **never raises** on a name
  that does not exist — so a filter builder can silently match nothing.
- **Pydantic validates on the way _out_ of Mongo**, so a new constraint that existing data violates
  produces a 500 on the endpoint serving that data. **Run a read-only data audit before adding any
  backend constraint**, and audit the correct half of a join: a model served from a join can look
  entirely broken when the wrong collection is checked.
- **A `re` `pattern=` on a Pydantic field uses `re.search`**, so a missing `^` silently unanchors the
  whole control.

**Ops and environment**

- **Docker ignore patterns fail silently.** A dead pattern looks identical to a live one, so ignore
  files accumulate patterns matching nothing while host build artifacts ship into Linux images.
  Spot-check by building a probe image.
- **Git Bash aliases `%TEMP%` to `/tmp`**, so a checkout or a scratch directory under it answers with
  a path a Windows binary resolves elsewhere or cannot open at all — a container binds the wrong
  directory, or a command dies mid-run. `cygpath -w` is the repository's existing answer, and
  `scripts/verify.sh` already spells its pool's shell that way.
