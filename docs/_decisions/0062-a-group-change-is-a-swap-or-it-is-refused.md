# ADR-0062 — A mid-season group change is a swap of two clubs, executed as one transaction

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Roadmap item FB-15, opened 2026-08-07 out of the admin teams work: the club editor's
Gruppe lock names a two-club swap as the one defensible mid-season move, and nothing offered one.

## Context

A club's group decides which table counts its results and which bracket slot its placing seeds
([ADR-0035](0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)), so moving one
club mid-season falsifies the table and the bracket at once. `REQ-ENTER-004` therefore locks a group
change the moment the season is under way and the club has a fixture in it
(`fl_backend/app/api/teams/services.py :: find_gruppe_move_refusal`), and the lock's own message names
the change that would have been defensible: two clubs exchanging groups, which keeps each group's size
and leaves every drawn fixture facing the opponents it was drawn against.

Nothing offered that exchange. `PATCH /teams/{team_id}/saisons/{saison_id}` addresses one junction row,
so the only way to express a swap was two calls — and between them the season holds one group a club
short and the other a club over. Every read of it in that window is a correct read of an illegal
season: the standings are derived on each request
([ADR-0019](0019-team-statistics-are-derived-from-spiele.md)), so a public table renders the broken
shape rather than a stale one. A failure after the first call makes that state permanent, and nothing
records that a second call was owed.

The competition also has a point past which no swap is defensible at all. A knockout slot is filled
from a group placing only once no remaining result can change it (ADR-0035), so the first knockout
result is the moment the standings stop being a live table and become the input the bracket was built
from. Exchanging the groups behind it rewrites what its slots meant.

## Decision

**`POST /saisons/{saison_id}/gruppen/swap` exchanges the groups of two clubs, writing both
`saison_teams` rows inside one transaction.** The body names `team1_id` and `team2_id` and nothing
else. `fl_backend/app/api/saisons/admin_router.py :: swap_gruppen` reads both rows through the
transaction's session, judges them, and writes each club the group the other holds.

**It lands on the season's write router, because a swap belongs to the season.** The club editor
addresses one club, which is the wrong grain for an operation whose subject is two of them.

**Neither side of the payload carries a group.** What is exchanged is what the two stored rows already
hold, so a form built against a season that has since moved cannot write a group nobody is standing
in. The response is assembled from those rows before either write and then written from, which refuses
a stored group outside the closed A–D set before anything lands and makes it impossible for the echo to
describe a swap other than the one that happened.

**Two refusals, both 409, decided by `fl_backend/app/api/teams/services.py ::
find_gruppe_swap_refusal`:**

1. **`REQ-SWAP-001` — the two ids must name two clubs of this season standing in different groups.**
   One club named twice, a club holding no junction row, and two clubs of one group all describe
   something that is not a swap. One code for the three, because the remedy is the same for all of
   them: the control offers only pairs that are a swap, so a request carrying one is stale or racing
   another admin.
2. **`REQ-SWAP-002` — no swap once any fixture outside the Gruppenphase carries an `ergebnis`.** That
   is the test for "the knockout has begun", and it is a result rather than a date, because a bracket
   whose matchday has arrived has still consumed nothing.

**`REQ-ENTER-004`'s lock is neither consulted nor relaxed.** A swap is precisely the case that lock's
message names as defensible, so this endpoint exists beside it rather than routing through it, and a
single mid-season move stays refused.

**The control is a panel on `/admin/saisons/[saison_id]`, and during the knockout it refuses rather
than warns.** It offers only pairs the write path accepts
([ADR-0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md)): the second picker disables
the club already chosen and every club of its group, each still visible with the reason beside it. A
season whose knockout has a result shows why the swap is closed in place of the pickers.

**What decides all of it: the operation is atomic or it is not.** Every other property here — where it
lands, what the payload carries, which refusals it performs — follows from a swap being one decision,
and a decision that can half-happen is not one.

## Consequences

**The backend test suite gained a second MongoDB container, and the reason is worth stating plainly:
until this change no test in this repository had ever executed a transaction.** The shared `mongod`
(`fl_backend/tests/conftest.py :: mongo_container`) is a standalone, which answers every transaction
with `IllegalOperation` — so `activate_saison` and `patch_spiel_data` are as unexercised in that
respect as this endpoint was. `mongo_replica_set_url` starts a single-node replica set beside it, and
`fl_backend/tests/api/test_gruppe_swap_execution.py` is the first test to prove a rollback. It runs
without authentication, because `mongod` refuses `--replSet` together with `--auth` unless it is also
given a keyFile, and three constraint tests need the first container's credentials — so the two exist
for two reasons rather than by duplication. Both are lazy, and the default tier starts neither.

**Proving the rollback needs a failure a test can cause, and only one is available.** The execution
suite attaches a `$jsonSchema` narrower than production's for that test alone, so the second write is
refused by the database one write into a transaction that has already changed a row. That stands in
for a write conflict, a stepdown or a crash, because the abort path is the same for all of them — but
it is a stand-in, and the other three remain unexercised.

**A `past` season can still be swapped while its knockout carries no result.** Nothing here reads
`status`, which is the bound deliberately not taken: the two rules above are the ones the item states,
and a season that played no bracket at all is exactly the abandoned season somebody might legitimately
be repairing. The cost is that a finished season's groups are editable in a way its scoring rules are
not (`REQ-RULES-005` freezes those), and the two ought to agree — a later decision may close it.

**There is no undo offer, and none is owed.** A swap is its own inverse: running it again on the same
pair restores the season. The panel says so, and the fifteen-second window plus a route handler
([ADR-0049](0049-every-page-owned-editors-undo-is-a-route-handler.md)) stays with the editors whose
save it belongs to.

**A three-way rotation is inexpressible, and stays that way.** Two swaps produce one, and each of them
is separately defensible; an endpoint taking N clubs would have to define what a partial rotation
means, which is the question the atomic pair does not have.

**The season editor makes two more reads per page load.** The clubs of the season, and its playoff
fixtures. Both are cached reads of public data, and the second is narrowed to the phase the rule asks
about rather than a whole season fetched and filtered on the page.

**The rule lives in the teams slice while the endpoint lives in the saisons slice**, which is the one
seam here a reader may trip over. It judges `saison_teams` rows, so it sits beside the entry rules that
judge the same rows and is named by `find_gruppe_swap_refusal` from the season's router.

## Alternatives considered

**Two client-side PATCHes against the existing junction endpoint.** Measured against what a reader of
the season sees while they run: there is a window in which one group is a club short and the other a
club over, and because the standings are derived on every request that window is public. Worse, a
failure after the first call leaves the season there permanently, with the second call owed to nobody.
No amount of client-side care removes it — the client cannot make two requests atomic.

**A general "move" endpoint with `REQ-ENTER-004` relaxed.** Measured against the lock's own argument,
which is right: a single move leaves a club's fixtures played against the group it left. It also has
the shape ADR-0038 forbids — offering a general operation while refusing most of its inputs — because
the only moves such an endpoint could accept are the ones that happen to be halves of a swap, and it
could not know which half was coming.

**The club editor as the home.** Measured against the grain of the page: it addresses one club, so the
second club is an act on somebody who is not the subject of the surface, and the "which club" question
would be asked twice on a page that has already answered it once. The season is the thing a swap
belongs to, and its editor exists.

**A warning instead of a refusal once the knockout has begun.** Measured against what a warning is for:
it is the right instrument when the admin knows something the system does not. Here the system knows
the whole of it — the seeding has consumed the standings — and there is no state of the world in which
proceeding is correct. A warnable version would be a refusal with a button beside it.

**Accepting the target groups on the payload.** Measured against the stale form: the client would then
be the source of truth for what each club currently holds, and a page open in a second tab would write
a group nobody is standing in. Reading both rows inside the transaction costs one query and removes the
class.
