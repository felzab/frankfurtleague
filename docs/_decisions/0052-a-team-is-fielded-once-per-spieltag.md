# ADR-0052 — A team is fielded once per Spieltag, and an ineligible one is refused where it is fielded

**Status:** Accepted
**Date:** 2026-08-06
**Surface:** backend, frontend
**Supersedes:** [ADR-0049](0049-eligibility-is-checked-where-a-team-is-fielded.md)
**Superseded by:** —
**Source:** Open item FB-9, and the reproduction that a team could be picked into two fixtures of one
matchday with nothing anywhere saying so.

## Context

[ADR-0049](0049-eligibility-is-checked-where-a-team-is-fielded.md) established where an eligibility
rule belongs in this system and why: a team never leaves a season
([ADR-0033](0033-one-active-season-and-one-path-to-it.md)), so the boundary the reference model checks
at — registration — does not exist here, and the check has to sit where a team is fielded instead. Its
three tiers stand, and this decision keeps them: a disqualified team newly fielded is refused, an
occupant disqualified after being placed is reported, and a manual pick that did not qualify from its
group is warned about and never refused.

**What ADR-0049 did not see is a second rule of the same class.** A team can be picked into two
fixtures of the same Spieltag. Nothing refuses it, nothing reports it, and the second pick leaves the
team standing in both — a club playing two matches on one matchday, which is not a thing that can
happen. It was found while building the edit page's pickers, where the answer to "which teams may I
choose here" had to be computed anyway.

**Neither mechanism the database applies can express it.** A `$jsonSchema` validator sees exactly one
document ([ADR-0027](0027-the-database-enforces-its-own-invariants.md)), and this is a relation between
several. A unique index reads one key per document, while the team sits in **either** of two embedded
fields — so a club in `team1` of one fixture and in `team2` of another is a collision no index can be
built to refuse. It is the same shape as the bracket faults: a contradiction between documents
([ADR-0047](0047-a-bracket-fault-is-derived-on-demand.md)).

**And nothing had ever checked whether the stored data satisfies it.**
`python -m app.core.constraints --check` reports what the validators would reject and what would stop
an index building; a cross-document rule is in neither list, so turning enforcement on would have been
done blind. Checked on 2026-08-06 against the live database before any of this shipped: **58 occupied
(Spieltag, team) pairs across 5 Spieltage, maximum one fixture per team per Spieltag — zero
offenders.** The check itself is now part of `--check` so the question stays answerable.

**The interesting half is what to do about a clash rather than whether to have the rule.** Refusing
every one of them makes the ordinary correction painful: an admin moving a team from one fixture to
another has to remember to empty the first, and gets a 409 telling them so. Emptying it automatically
is right — except where the occupied side carries a `quelle`, because a side with a source is the
resolution's and not a person's ([ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md)), so
emptying it is reverted on the next pass. That write would report a success it did not achieve.

## Decision

**A team is fielded at most once per Spieltag, enforced at the write path.** The rule lives in
`fl_backend/app/api/spiele/services.py :: judge_spieltag_occupancy`, pure, beside the wiring rules
rather than inside them.

**On a clash, move a manual side; refuse against a maintained one.** Fielding a team here is a
statement about where it plays, so the other fixture gives it up — and loses its own result with it,
for exactly the reason an advancement does: the goals were scored against the team being removed. Two
cases refuse instead, and both because moving would not stick:

- **The occupied side carries a `quelle`** — the resolution owns it, and emptying it is undone.
- **Both sides of the payload name one club** — there is nothing to move it to, since the only side to
  empty is one the caller has just filled in. This is also the one shape the wiring rules cannot see:
  they key a source by identity, and two hand-set sides carry no source at all
  ([ADR-0046](0046-the-write-path-refuses-wiring-the-season-cannot-hold.md)).

Every side emptied this way is named in `released_sides`, for the reason
[ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) names a voided result: a write the
caller did not ask for is one whose effects have to be visible.

**An occupant refusal answers its own 409 code, one per rule.** `REQ-ELIGIBILITY-001` is a disqualified
team newly fielded, `REQ-ELIGIBILITY-002` a team with no `saison_teams` row for the season, and
`REQ-SPIELTAG-001` the clash above. Never `REQ-WIRING-001`'s code: its advice is "reload the page",
which is right for a season that has moved under the form and wrong for every one of these, where the
season has not moved at all.

**The form places the message on the side that caused it, and the code is what tells it which rule
fired.** A failure body is `{error_code, correlation_id}` and nothing else
([ADR-0039](0039-one-correlation-id-per-request-one-document-per-line.md)), so the code is the only
channel — and it stays **one code per rule**, because "team1 is disqualified" and "team2 is
disqualified" are one failure mode and the code table's own rule is one code per mode. The side is the
client's to determine, which it can: the predicates are the ones `FormTeamPicker` already evaluates to
disable a team and put a chip on it, over the same data. A side it cannot identify falls back to a
toast, so a refusal is never swallowed.

**Both occupant rules apply only to a team the payload NEWLY fields.** ADR-0049 put that clause on the
disqualification rule alone; it belongs on the missing-row rule for the identical reason. Without it, a
fixture already holding such a team becomes uneditable — including by the edit that would resolve it,
which is the fixture an admin most needs to open.

**`--check` reports the cross-document rules it cannot apply.** `report_relations` in
`fl_backend/app/core/constraints.py` counts the stored groups each one is broken by, alongside the
validators and the indexes, and its offenders count into the same verdict. It is reported and never
applied: the question `--check` exists to answer is whether the data satisfies a rule that is about to
be enforced, and a rule enforced at the write path leaves everything that predates it in place.

## Consequences

**A match write can now change a fixture on grounds that have nothing to do with the bracket.** That is
new, and it is the cost of the move. It is bounded — one Spieltag, sides with no `quelle` only — and
every one is reported, but a reader of `spiele` history will find a fixture emptied by a save that
never named it.

**A release destroys a result, and it is the only rule here that destroys anything.** The fixture the
team leaves loses its `ergebnis` and `elfmeterschiessen`, because they were scored against a team no
longer in it. The dry run of ADR-0051 names it before the save, and the undo toast covers it after.

**Releases are applied before the resolution, on both paths.** A slot a release opens can be refilled
by the resolution that follows, so the reverse order would leave the season one pass behind and the
preview would name a different set of fixtures than the save moved.

**The write path gains a junction read inside its transaction**, as ADR-0049 already accepted:
sixteen rows, on a path that already reads the season's fixtures, paid per match write rather than per
page view. It reads `saison_teams` directly rather than through `build_team_pipeline`, which skips
match-fed seasons and filters `inactive_since` — both of which would drop a row this rule must see.

**One accepted edge survives from ADR-0049**: swapping a stored disqualified occupant from one side to
the other is refused, because it counts as newly fielding. Entering a historical season is therefore
field-first and disqualify-second, which is the order a season is recorded in anyway.

**The one-per-Spieltag rule is about the matchday, never the season.** A team plays every round it
reaches, so the same club in a group fixture and in a semi-final is the ordinary case and must stay
free. Anything that widened this to the season would refuse the bracket.

**Enforcement leaves the past alone.** A stored violation predating this is not corrected by anything
and would only surface on the next edit of one of the two fixtures. That is why the check is in
`--check` rather than in a test: the answer changes with the data, not with the code.

## Alternatives considered

**Refuse every clash, and let the admin empty the other fixture first.** Symmetrical, simpler to
implement, and it turns the most ordinary correction — a team was entered against the wrong opponent —
into a two-step procedure whose order matters. It also gives the admin a 409 for doing the thing they
meant to do.

**Move in every case, including a `quelle`-maintained side.** It reads as more consistent and it is a
write that does not hold: the resolution restores the occupant on the very next pass, quite possibly
inside the same request. A success response for a change that reverts itself is worse than a refusal.

**Enforce it with a unique index.** Impossible rather than rejected, and worth recording so nobody
spends an afternoon on it: the team is in one of two embedded fields, so no key spelling makes the two
placements collide. A `$jsonSchema` validator is equally unable — it sees one document.

**Report it as a sixth bracket fault instead of refusing it.** Consistent with ADR-0047's "derive, do
not store", and it gives up the one moment where the correction is free: the admin is looking at the
form with the team list open. A fault found later means reopening a fixture whose date may have
passed, and unlike the five faults, this one has an obvious right answer that does not need a person.

**Widen `find_wiring_refusal` with the occupant rules.** Rejected for ADR-0049's reason, unchanged: its
contract is that it decides wiring from wiring, its input carries no membership data, and its four
rules share a "skip a side with no source" preamble that is false for rules applying **only** to a side
with no source.

**Per-side error codes, so the client needs no predicate of its own.** It would put the field in the
one channel a failure body has, and it doubles the code table for a distinction that is not a failure
mode. The codes are what make logs greppable; `REQ-ELIGIBILITY-001` and `REQ-ELIGIBILITY-002` meaning
the same thing about different fields is exactly the reuse the exceptions module forbids.
