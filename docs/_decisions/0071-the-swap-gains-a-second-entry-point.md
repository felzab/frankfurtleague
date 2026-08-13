# ADR-0071 — The group swap gains a second entry point on the club editor, with one side fixed

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Owner instruction, 2026-08-13: the club editor's locked Gruppe row names the swap as the
defensible operation and routes nowhere, while the season panel's own hint points back at the club
editor, so the two send an admin in a circle.

## Context

[ADR-0062](0062-a-group-change-is-a-swap-or-it-is-refused.md) put the swap on
`POST /saisons/{saison_id}/gruppen/swap` and its control on `/admin/saisons/[saison_id]`. Among the
alternatives it rejected is **the club editor as the home**, measured against the grain of that page:
it addresses one club, so the second club is an act on somebody who is not the subject of the surface,
and the "which club" question would be asked twice on a page that has already answered it once.

The same decision also made the club editor advertise the operation. `REQ-ENTER-004` locks the Gruppe
picker once the season is under way and the club has a fixture, and the lock's message names a swap of
two clubs as the change that _would_ be defensible
(`fl_backend/app/api/teams/services.py :: find_gruppe_move_refusal`). So the page that must not host
the swap is also the page that tells an admin the swap exists. Nothing on it led there.

The season panel closed the loop in the wrong direction. Its `InfoHint` ended by saying a single change
is the club page's business and is locked there — so an admin standing on either page was pointed at
the other, and neither statement was false.

**What makes this worth an ADR rather than a bug fix (DEC-1): somebody will read the new control as the
rejected alternative and try to remove it.** The two look alike from a distance and differ in exactly
the places ADR-0062 measured.

## Decision

**Add a second entry point to the swap on `/admin/teams/[team_id]`, offering ONE picker, and leave the
season panel as the swap's home.**

**One picker, because the page has already answered "which club".** The club the URL names is one side
and is never chosen; the control asks only for the other. That is the direct remedy for the second half
of ADR-0062's objection — the "which club" question is asked once on this page, not twice — and it is
the whole shape difference from `FormGruppenSwapSection`, which asks for both because a season names
neither.

**It writes the same endpoint, in the same single transaction, through the same action**
(`fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`). There is no second write, no
client-side pair of PATCHes, and no new endpoint. **`REQ-ENTER-004`'s lock is neither consulted nor
relaxed**: the control renders _because_ the lock is on, beneath the row the lock produces, and a single
mid-season move stays refused by the junction write exactly as before.

**It appears only while the group is locked.** With the picker still free a direct change is legal and
simpler, so offering two routes to one outcome would be the page asking an admin to choose between them.

**Both surfaces grade a pair through one derivation**, `fl_frontend/src/features/saisons/utils.ts ::
findSwapPartnerRefusal` over the context `buildGruppenSwapContext` assembles. `REQ-SWAP-001`'s
same-club and same-group halves, `REQ-SWAP-004` and `REQ-SWAP-005` are decided there, in the endpoint's
own order, so what one entry point offers the other offers too and both offer only what the write path
takes ([ADR-0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md)). The two surfaces word
those refusals differently and nothing else: on the season page a row says what is true of the pair,
here it says what is true of the club in it, because one side is already named at the top of the page.

**A refusal that applies to every pair alike closes the control instead of grading a row.** A `past`
season (`REQ-SWAP-003`), a knockout that has begun (`REQ-SWAP-002`) and this club having played inside
its own group (`REQ-SWAP-004` for the fixed side) each replace the picker with the sentence that says
so. Attaching a season-wide bound to one row would send an admin to look at the wrong club.

**The two hints now say the same thing from two places.** The season panel's says a single change stays
locked and that the same swap can be started from the club page with that club as one side; the club
panel's says the group is editable only before the season starts and that afterwards the swap is the one
route, here or on the season page. Neither points at the other as the place to go.

**`REQ-ENTER-004`'s German names the route that is still open** rather than stopping at "not possible"
(`fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`), and it can, because the control the
second sentence names is on the screen the message lands on.

## Consequences

**The club editor makes two more reads per page load** — the season's playoff fixtures and its
group-phase ones, the same two the season editor makes and for the same rules. Both are cached public
reads carrying the season's granular tag ([ADR-0001](0001-two-granular-cache-tags.md)). The club list
costs nothing extra: `getTeamMemberships` already returns every club with every junction row, so
narrowing it to the selected season yields the same strict join `GET /teams?saison_id=` would, retired
clubs included, which an admin picker needs ([ADR-0025](0025-soft-deletion-is-a-date-not-a-flag.md)).

**Two surfaces can now start the same write, and a rule stated on one and not the other is a defect on
both.** That is the standing cost, and it is why the grading lives in one function rather than in each
component. A future refusal added to `find_gruppe_swap_refusal` has to reach that function, or one
surface will offer a pair the endpoint answers with a 409.

**A swap started here changes the page's own subject.** The club's group is what the locked row shows,
so the control refreshes the route on success and the editor reopens on the group the swap produced.
The action's cache invalidation is unchanged and already reaches `teams` and `spiele` on both layers.

**The swap is still not a field.** It writes the moment it is confirmed and never joins the club
editor's save bar, which is why its confirmation panel says so in as many words: the two writes on this
page have different triggers and an admin should not have to infer that.

**It does not mirror a refusal it cannot compute.** A sixth refusal over a disqualified club is being
added to the endpoint; until its predicate is expressed in `findSwapPartnerRefusal` both controls will
offer a pair it refuses, and the refusal will arrive as a failure toast rather than as a disabled row.
That is the ADR-0038 gap this decision knowingly leaves open, and closing it is one function plus one
message.

## Alternatives considered

**Leave the lock's message as the only mention, and route nowhere.** Measured against what the message
does: it names an operation, so a reader looks for it, and the page it is on has no link to the season
editor, no season id in view, and no way to know which season's editor to open. A sentence that names a
capability without reaching it is worse than one that does not mention it, because it spends the
reader's attention twice.

**Link to the season editor instead of embedding a control.** Cheaper, and it keeps the swap in exactly
one place. Measured against what the admin is doing: they have this club open, they have just been told
this club's group is locked, and the link would hand them a panel that asks which two clubs to exchange
— the first of which they have already decided and cannot express in the link. The "which club" question
would then genuinely be asked twice, which is the objection ADR-0062 recorded, reintroduced by the
remedy meant to avoid it.

**Make the club editor the home and remove the season panel.** This is ADR-0062's rejected alternative
and it stays rejected. A season is the subject a swap belongs to; the season panel is where an admin who
has not yet decided _either_ club belongs, and it is where the operation's explanation, its closed-season
and knockout states, and its documentation live. Nothing here moves any of that.

**Offer the swap on the club page whether or not the group is locked.** Measured against the unlocked
state: the group picker beside it already performs the change directly, in one write, with no second
club involved. Two controls for one outcome is a choice an admin has to make and cannot make well.

**Duplicate the pair-grading arithmetic in each component.** Measured against what it has to stay equal
to: `find_gruppe_swap_refusal` and `_spieltag_clashes` on the server. Two copies drift silently, the gate
sees neither, and the failure is a control offering a 409 or hiding a legal swap. ADR-0062 accepted a
deliberate second statement of `REQ-SWAP-005` on the backend, and gave the reason — the two writers hold
different shapes and reach different outcomes. Neither is true of these two components: they hold the
same snapshot and can only refuse.
