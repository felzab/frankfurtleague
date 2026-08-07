# ADR-0063 — A matchday list is the season's skeleton, and the rollover belongs to the season's own page

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FB-6, plus the owner's question of 2026-08-07 — whether the admin surface needs a
design of its own or should reuse the public Spielplan, which already works.

## Context

FB-6 built the last two pages of the admin-surface string, and the string's patterns were three times
proven: an `AdminCrudShell` header row over an `AdminCrudView`, a table below `md` becoming stacked cards,
a page-owned editor where the form outgrew a dialog
([ADR-0050](0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)). Copying them is what the entry
prescribed, and for `saisons` copying them was right.

**Two questions had no precedent to copy, and the owner raised the first one directly.**

**The matchday surface.** `/dashboard/spielplan` is a sticky tab strip — one tab per Spieltag, one panel
of match cards behind it (`fl_frontend/src/features/spieltage/components/views/SpielplanView.tsx`). It
works, and the owner asked whether the admin needed anything different. Read against what it renders, it
shows exactly one field of a Spieltag: `name`. The rest are invisible.

What an admin asks about matchdays turned out to be comparisons rather than lookups:

- **Are the phases in bracket order?** A matchday carries `saison_phase`, and a Halbfinale rendering ahead
  of the Viertelfinale it follows is a defect no single document can express.
- **Does the sequence read as a sequence?** The order of a season's matchdays is the shape of the season,
  and a surface that shows one at a time cannot show a shape.
- **Does `anzahl_spiele` match what is attached?** It is a hand-maintained count of something countable,
  written as given and never derived —
  [ADR-0026](0026-team-statistics-are-derived-from-spiele.md)'s derivation pointedly does not extend to
  it. Nothing compared it against the fixtures actually carrying the matchday's id.

A tab strip answers none of those, because each needs several matchdays on screen at once. A flat CRUD
table shows all the fields and hides the structure they describe.

**The rollover's placement.** `POST /saisons/{saison_id}/activate` is the only code path that writes
`status`, and [ADR-0033](0033-one-active-season-and-one-path-to-it.md) deliberately refused a backend
"have all the games finished" guard: an early rollover is a legitimate decision, and the one case where
somebody genuinely needs to activate a season is when the data is _not_ in the state a rule would assume.
That ADR assigned the precondition to FB-6's UI and said nothing about where on it.

## Decision

**The matchday surface is a phase-sectioned ordered list, not the Spielplan's tab strip and not a table**
(owner, 2026-08-07). `fl_frontend/src/features/spieltage/components/collections/AdminSpieltageList.tsx` is
the whole surface: one section per `saison_phase` in the order a season runs them, and within a section the
rows in the order the API returned them.

**The list re-sorts nothing.** A matchday's position is derived by the backend
([ADR-0064](0064-a-matchdays-position-is-derived-not-stored.md)), so the order arrives correct and a second
ordering here would be a second answer to a settled question. What the row shows is an **ordinal** — its
1-based place within its phase section, counted by the page over the order it received. It is presentation:
two rows cannot claim the same one, and it cannot disagree with where the row actually is.

**The ordinal shares the identity's row at every width** (owner, 2026-08-07). On a phone a marker on its
own line spends a whole row on one digit; a number belongs beside the thing it numbers, and from `md` the
same wrapper is the start of the horizontal layout.

**`anzahl_spiele` against the attached count is marked on the row.** It renders as the fixtures actually
carrying this matchday's id over the stored expectation, tinted where they disagree. This is the one fact
about a matchday that nothing else in the system can catch.

**A phase with no matchday is skipped, and the phases without one are named once at the foot.** A season
part-way through its setup has no Finale yet, so "not reached" is the normal state and four empty headings
would read as four things missing.

**Nothing here refuses what the API permits.** An end date before a begin date, a qualifier count above the
group size: each is stated on the surface that can see it and saved anyway. A page that refused would be
enforcing a rule the endpoint does not have, and a season mid-setup passes through those states
legitimately.

**The matchday editor is a dialog, and the season editor is a page.** ADR-0050's threshold is a form that
_outgrew_ a dialog: five scalar controls with no nested object, no junction row and no lookup list do not
reach it, and the Spielort form beside it is the same size in the same container. The season editor does
reach it — the rollover panel alone is a variable-length list of fixtures — so `/admin/saisons/[saison_id]`
is a page with the full page-owned apparatus: one descriptor table, per-field markers, a summary rail, one
save bar, a discard guard, Ctrl+S, and an undo route handler
([ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)).

**The rollover control lives on the season's own editor page** (owner, 2026-08-07), as a panel and not a
row action. It presents the outgoing season's unfinished matches as a **list** rather than a count, each
row linking into the fixture, because the count alone says something is open and nothing about whether it
matters — a finale without a result is a different decision from four group games nobody is waiting on. It
is a control rather than a field: it writes the moment it is pressed and never joins the save bar, the shape
the retire and reactivate controls take on the other editors.

**The rollover is the one write on these two pages that confirms rather than offers an undo**, which
inverts [ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md)'s preference on purpose. That
preference rests on the save being invisible until somebody notices; a rollover changes what every public
page shows to a visitor who named no season, for two seasons at once, immediately. There is no window in
which it goes unnoticed, so the useful protection is before rather than after. It also refuses while the
page holds an unsaved draft, because it revalidates the route and would otherwise discard typed values
through a control that says nothing about editing.

**A season has no delete control anywhere**, so `AdminCrudView`'s `renderDeleteModal` is now optional. One
that is over is `past`; deleting it would orphan every spiel, spieltag and junction row carrying its id
(ADR-0033).

**Every soft delete in the admin now says so** (owner, 2026-08-07). All five `DELETE` endpoints stamp
`inactive_since` and keep the document ([ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md)), and the
row renders a Reaktivieren control the moment the write lands — but `ConfirmDeleteModal` hardcoded
"wirklich löschen", "kann **nicht** rückgängig gemacht werden" and "Ja, endgültig löschen" for every one of
them. The verb and the reversibility sentence are now the caller's, defaulting to retirement, and
`isPermanent` exists for a caller whose write genuinely cannot be taken back. There is none today.

## Consequences

**`renderTable` was always a slot and is now demonstrably one.** `AdminCrudView` gained nothing to serve a
list instead of a table: the matchday page passes a sectioned list into the same prop the five tables use,
and the search field, the filter bar, the edit overlay and the retire overlay are unchanged. A seventh
resource can be whatever shape its question needs.

**`anzahl_spiele` now has one surface that can catch it drifting**, which makes it the only
hand-maintained count in the system with a check. It is still not derived, and ADR-0026 still does not
extend to it.

**Two pages end ADR-0035's staleness window for `saisons` and `spieltage`.** Every write invalidates its own
tags as it saves, which is the durable fix
[ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md) deferred to. A hand edit made
directly in MongoDB still goes around all of it and is still bounded by the daily cache lifetime; there is
still no invalidation endpoint.

**The rollover invalidates four resources, not one.** An omitted `saison_id` means the current season,
resolved in the backend handler ([ADR-0002](0002-omitted-season-means-current.md)), so promoting a season
changes what `/spiele`, `/spieltage` and `/teams` return to a request that named no season — which is most
public traffic. None of those entries carries the promoted season's id, so the base tags are the whole
invalidation set. A season **edit** invalidates `saisons` and `teams`, because the league table is scored
from `rules.win_points` and `draw_points` on every read (ADR-0026).

**`FLSaison.rules` has an editor for the first time**, so all six fields are writable through the API and
the four that had never been written by anything now can be. Three of them reach further than a form
suggests: the two point values rescore every standing of the season on the next read, `qualifiers_per_group`
is what the seeding walk asks each group for
([ADR-0043](0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)), and
`number_of_groups`/`teams_per_group` bound what the junction write accepts. The editor states each of those
where the field is, because none of them is visible from the number itself.

**`erlaubte_stufen` narrows an offer and never a stored row.** No validator holds `saison_spieler.stufe`
against a season's list ([ADR-0061](0061-position-and-stufe-are-closed-sets.md) holds it against the
league's), so narrowing a season cannot retroactively invalidate the squads of a season already played —
and the editor says so rather than letting the admin infer it.

**Eight backend components lost their `BACKEND_ONLY` exemptions** in `fl_frontend/src/core/apiContract.test.ts`,
so the season and matchday write payloads are now compared against the published document field by field
([ADR-0040](0040-the-zod-mirror-is-checked-against-the-published-document.md)).

**A fourth undo route handler exists.** ADR-0062 replaced a count with a pattern precisely so this would not
need superseding it: an undo belongs to a page-owned editor, `/admin/saisons/[saison_id]` is one, and the
handler is the same shape as the other three. The revert when E592 is fixed upstream is now four handlers
and four call sites.

**The seasons page is the one admin table with nothing destructive in it.** Three read links and one edit
link per row, which is worth knowing before looking for the trash control that is missing.

## Alternatives considered

**Reuse the Spielplan's tab strip for the admin matchday surface.** The owner's own question, and the
assistant recommended against it. The public page is right for its job: a reader wants one matchday's
fixtures, so the matchday is a container you navigate into. Every admin question about matchdays is a
comparison between them, and a strip shows one at a time — the worst possible shape for comparison. It also
renders one of the fields, so the phase, the expected count and the retirement state would all still be
invisible.

**A plain CRUD table, copying the four that existed.** What FB-6 prescribed, and rejected for the matchday
half alone. It would show every field and hide the structure the fields describe: sectioning by phase is
what makes a mis-phased matchday visible. The season half did copy the table, because a season has no
ordering to render.

**A drag-to-reorder list with a bulk `PATCH /spieltage/order` endpoint.** Put to the owner as the third
option and declined, then made moot: ADR-0064 removed the stored position a reorder would have written, so
there is no longer anything for a drag to rearrange.

**A link from each matchday row into its fixtures.** Built, then removed: `/admin/spielsuche` searches team,
venue, date, fixture number and referee, and a matchday's name is none of those, so `?q=<name>` lands on an
empty list. The attached count answers the question the link was for, and the public Spielplan at the foot
of the page is the outbound link that works.

**Put the rollover on the seasons list as a row action.** Where an admin would naturally go looking for it
at rollover time, and rejected on what the dialog would have to hold: the incomplete-matches list is
variable-length, and squeezing it into a confirmation dialog is how it becomes a count instead — which is
the shape ADR-0033 assigned this UI to avoid.

**Both places, sharing one confirmation component.** Rejected on CLAUDE.md §3's trip-wire about two
surfaces over one payload, which is the arrangement that produced the drift the match form was repeatedly
corrected for.

**Refuse the rollover while the outgoing season has unfinished matches.** Already refused by ADR-0033 for
the endpoint, and refused here for the page too. The page shows and permits; a UI-level block would be the
same rule with no override, moved one layer up where it is easier to forget it exists.

**Offer an undo on the rollover instead of a confirmation.** Consistent with the other three editors and
rejected: fifteen seconds of Rückgängig on a write that has already changed what the public site shows is a
promise the toast cannot keep, and the inverse write is a deliberate act on another season's page rather
than a replay of a payload.

**Give the matchday editor a page, for consistency with the other three editors.** Rejected because
ADR-0050's threshold is a measurement rather than a preference: five scalar fields do not produce the
1,740-line, 311px-wide concentration that decision was taken about, and a page for them would be a route,
a rail, a descriptor table and an undo handler carrying a form the size of the Spielort dialog.

**Derive `anzahl_spiele` and drop the field.** Tempting, and out of scope: it would be a schema change plus
a decision about what the number means for a matchday whose fixtures have not been entered yet, which is
the state the count exists to describe.
