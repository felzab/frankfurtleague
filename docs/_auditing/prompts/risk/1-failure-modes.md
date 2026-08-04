# Risk pass 1 — failure modes and audit coverage

Paste into a fresh session (or run via `/audit:pass risk 1`).

**Run this pass FIRST**, before any surface pass in the programme. Its register tells the later
passes what they are responsible for covering, and it is the only pass that starts from consequences
rather than from a part of the stack.

---

Audit pass 1 of 1 on failure modes. Lens: WHAT WOULD ACTUALLY HURT — enumerate the outcomes this
system must not produce, trace each to the paths that could produce it, and establish whether any
pass in this programme is going to look there.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/r1-failure-modes.md`.

DELIVERABLE: the failure-mode register (check 2) and the coverage map (check 3) are required tables
and are the pass's whole point. Every later pass in this programme reads its own rows from them and
must state, in its verdict, whether it covered each.

WHY THIS PASS EXISTS: every other pass is named after a part of the stack — caching, styling,
schemas, nginx. A lens shaped like the stack finds defects shaped like the stack, and **nothing in
that set asks what would actually hurt.** A defect can be technically minor and consequentially
severe, or technically alarming and harmless. This pass supplies the consequence axis, so severity
across the programme means something and so a hazard nobody's lens happens to cover is visible as a
gap rather than as silence.

SCOPE: the whole system, whichever surface this programme is auditing. A hazard outside this
programme's surface is still registered — it is filed as a roadmap item rather than a ledger row
(check 4), so it is not lost between programmes.

CONTEXT — derive, do not assume. Establish before enumerating anything: what this system is for and
who uses it (`docs/README.md`, `docs/glossary.md`); what data it holds and which of it is personal;
what is published to the public internet versus what sits behind authentication; what a wrong
answer would look like to a reader who trusts the site. Read `docs/_decisions/` for the invariants
already ratified — a hazard an ADR has already accepted is a recorded risk, not a finding.

THE CHECKS, in priority order:

1. **ASSETS AND TRUST BOUNDARIES.** Name what is worth protecting and what separates it from
   everything else: the data stores and what each holds, the trust boundaries actually crossed (open
   internet → nginx → Next → FastAPI → Mongo), and who holds what at each position — an anonymous
   visitor, a holder of a leaked internal key, someone on the compose network, the owner. Every later
   judgment about reachability is relative to this list, so state it once and state it precisely.

2. **THE FAILURE-MODE REGISTER.** The required table, one row per distinct bad outcome:

   | ID | Outcome, in plain terms | Mechanism that could produce it | Where it would originate | Detectability | Consequence | Existing control | Register severity |

   - **Outcome** is stated as harm, not as a defect class: "the league table shows a team above one
     it actually lost to", not "aggregation bug".
   - **Mechanism** is concrete and traceable to code, config or an operational step.
   - **Detectability** is `loud` (something visibly breaks), `quiet` (wrong but plausible output) or
     `silent` (nothing anywhere indicates it). Use the shared protocol's severity rubric — a silent
     wrong answer outranks a loud outage.
   - **Existing control** names what would prevent or catch it today: a validator, a guard, a test, a
     lint rule, an index, a type, or **nothing**.

   Enumerate systematically rather than by inspiration. Walk at least these classes and say
   explicitly where each does not apply: data loss · data corruption · a silently wrong answer served
   as fact · unauthorised read · unauthorised write · personal-data exposure · loss of availability ·
   loss of the ability to recover (backups, rollback, reproducible deploy) · loss of the ability to
   tell that any of the above happened.

3. **COVERAGE MAP — DOES ANY PASS LOOK HERE?** The required table, one row per register entry:
   register ID | the pass whose lens would find this mechanism | the specific check number within it
   | covered / partly covered / **NOT COVERED**. A `NOT COVERED` row is the highest-value output of
   this pass: it means a hazard that no lens in the programme is pointed at. For each, state the
   cheapest fix — an extra check appended to a named pass, or a hazard that needs its own
   investigation — and say which.

4. **OUT-OF-SURFACE HAZARDS.** Register rows whose mechanism lives outside the surface this
   programme audits. List them separately with the owning surface named. These do not become ledger
   rows; they go to `docs/roadmap/open-items.md` so the next programme on that surface inherits them.

5. **CONTROL DURABILITY.** For every register row whose "existing control" is not `nothing`: is that
   control enforced automatically, or does it depend on someone remembering? An invariant held only
   by convention is a control with no owner. Report the inventory: control | enforced by | what
   silently disables it. **A control that can be removed without anything failing is the same as no
   control**, and this is where an audit finds the ones already half-removed.

6. **RECOVERY POSTURE.** For the highest-consequence rows: if this happened at 02:00 on a Sunday,
   what would make it visible, what would make it stop, and what would restore correct state? Name
   the actual mechanism or state plainly that there is none. Recovery gaps are findings — an
   unrecoverable low-probability failure outranks a recoverable likely one.

CROSS-SURFACE QUESTIONS: which outcomes actually matter, and how bad each would be, is the owner's
judgment and not derivable from code. **Present the register's severity column to the owner as one
batch for confirmation**, since every later pass inherits it. Where you had to assume, say so on the
row.

BOUNDARIES — not this pass: finding the defects themselves. This pass establishes what to look for
and who is looking; the surface passes do the looking. Do not report a code-level defect here beyond
a one-line pointer naming the pass that owns it, and never prescribe a fix — a remedy chosen before
the mechanism is confirmed is the shape of finding that inverts later.
