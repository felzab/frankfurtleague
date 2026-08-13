# ADR-0072 — The matchday editor becomes a page, on what a form must say rather than on how many fields it has

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** frontend\
**Supersedes:** ADR-0050\
**Superseded by:** —\
**Source:** My instruction of 2026-08-13, that all three remaining dialog editors — Schiedsrichter,
Spielort and Spieltag — become pages.

## Context

[ADR-0050](0050-a-matchday-list-is-the-seasons-skeleton.md) settled the matchday surface, and refused
a page for its editor twice — once in the decision itself and once in its alternatives:

> **The matchday editor is a dialog, and the season editor is a page.** ADR-0040's threshold is a
> form that _outgrew_ a dialog: five scalar controls with no nested object, no junction row and no
> lookup list do not reach it, and the Spielort form beside it is the same size in the same
> container.

> **Give the matchday editor a page, for consistency with the other three editors.** Rejected because
> ADR-0040's threshold is a measurement rather than a preference: five scalar fields do not produce
> the 1,740-line, 311px-wide concentration that decision was taken about, and a page for them would
> be a route, a rail, a descriptor table and an undo handler carrying a form the size of the Spielort
> dialog.

**On that measurement the case for a page has since got weaker, not stronger, and this record says so
rather than pretending otherwise.** The form held five fields when ADR-0050 was written and holds
three now: [ADR-0051](0051-a-matchdays-position-is-derived-not-stored.md) removed the stored
position and [ADR-0052](0052-a-seasons-schedule-is-derived-from-its-rules.md) removed
`anzahl_spiele`. Counting controls, `beginn`, `ende` and `saison_phase` are further below
[ADR-0040](0040-a-form-that-outgrows-a-dialog-becomes-a-page.md)'s threshold than the five that were
refused.

**Three things did change, and none of them is the field count.**

**The apparatus stopped being per-editor.** ADR-0050 priced a page at "a route, a rail, a descriptor
table and an undo handler", and in August that price was accurate — the match editor was the only
page-owned editor and everything on it was its own. It is not accurate now.
`fl_frontend/src/shared/components/ui/formPanel.ts`, `RailSection.tsx`, `railBanner.ts`,
`InlineBanners.tsx`, `DraftChangeList.tsx`, `ConfirmDiscardModal.tsx`, `ConfirmSaveModal.tsx`, and
the three hooks `useDraftValidation`, `useServerFieldErrors` and `useUnsavedChangesWarning` are all
shared and all already written. What a seventh editor costs is a descriptor table, a banner list, a
thin shell and a route handler. The cost side of ADR-0050's measurement collapsed; nothing on the
benefit side moved to compensate.

**What the form has to _say_ grew while its field count shrank, and those are different quantities.**
Removing the position and the match count did not remove their subject matter — it turned each into a
derivation the admin now has to be told about, because a number nobody can see is a number nobody can
check. Both explanations exist today, as one 60-word `Callout` at the foot of the dialog
(`fl_frontend/src/features/spieltage/components/forms/SpieltagFormFields.tsx`). That callout is the
dialog admitting it has nowhere else to put them.

**Six refusals now stand behind three fields.** `REQ-SPIELTAG-002` refuses a phase too small for the
fixtures attached; `REQ-SPIELTAG-004` refuses a phase the season's bracket never reaches;
`REQ-DATE-002` refuses a span outside the season's; `REQ-DATE-003` refuses a span that no longer
covers the matchday's own fixtures; `REQ-RETIRE-002` refuses retiring one that holds a result; and
`REQ-RETIRE-005`, added 2026-08-13, refuses retiring one whose phase would drop below the count its
rules imply. A dialog has one channel for all six — a toast after the request has already been
refused. A page has a rail that can state the ones it can see _before_ the admin reaches the control.

**And [ADR-0070](0070-a-draft-carrying-a-warning-is-confirmed-before-it-saves.md) is now built on a
mechanism only a page has.** A draft carrying a `warning` or a `danger` is confirmed before it saves,
and what decides that is the editor's own banner list resolved through
`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveRailBanners`. A phase change that moves
a matchday to another place in the season is exactly the edit that rule exists for. In a dialog it
cannot be raised at all, because there is no list and no rail to resolve against.

## Decision

**The matchday editor is a page at `/admin/spieltage/[spieltag_id]`, and the dialog retires** (my
instruction, 2026-08-13). It carries the same apparatus as the other six: one descriptor table
behind every marker, a field judged when it is left with the schema the action parses, panels rather
than rules between sections, a sticky summary rail, one save bar with the unsaved count, a discard
guard, Ctrl+S, ADR-0070's confirmation, and the fifteen-second undo as a route handler
([ADR-0049](0049-every-page-owned-editors-undo-is-a-route-handler.md)).

**The threshold ADR-0040 sets is not lowered, it is re-read.** What that decision measured was a form
whose concentration had outgrown its container, and field count was the proxy available at the time
because the alternative cost a page's whole apparatus. With the apparatus shared, the honest
question is **how much a form has to say about what it does not show** — derived values, cross-field
consequences, refusals it cannot pre-empt. A three-field form with nothing to say about its three
fields is still a dialog, and the create dialog for a matchday remains one for exactly that reason:
it writes a document that has no fixtures yet, no phase count to disagree with and nothing derived to
explain about a row that does not exist.

**The retirement moves onto the page and stays reversible.** `REQ-RETIRE-002` and `REQ-RETIRE-005`
are both facts the page already holds — the played count and the phase's live count against its
implied floor — so the control states why it cannot succeed instead of opening a dialog onto a 409.
The list keeps its own retire and reactivate controls, because the list is where a whole season's
matchdays are compared and a mis-created one is spotted.

**Everything else ADR-0050 decided stands, and is restated here because this record replaces it:**

- **The matchday surface is a phase-sectioned ordered list**, not a table and not the public
  Spielplan's tab strip. Every admin question about matchdays is a comparison between them.
- **The list re-sorts nothing** (ADR-0051). The `ordinal` a row shows is its 1-based place within its
  phase section, assigned from the order the API returned, and it is presentation alone.
- **`anzahl_spiele` against the attached count is marked on the row**, tinted where they disagree.
- **A phase with no matchday is skipped, and the phases without one are named once at the foot.**
- **Nothing on either surface refuses what the API permits.** A season mid-setup passes through
  states a page-level rule would call mistakes.
- **The rollover control lives on the season's own editor page**, as a panel presenting the outgoing
  season's unfinished matches as a list rather than a count. It is not a row action, and there is no
  reorder endpoint for `spieltage` to give one to.
- **The rollover confirms rather than offering an undo**, inverting ADR-0041 on purpose: it changes
  what every public page shows, for two seasons at once, immediately.
- **A season has no delete control anywhere**, so `AdminCrudView`'s `renderDeleteModal` is optional.
- **Every soft delete in the admin says so** — the verb and the reversibility sentence belong to the
  caller of `ConfirmDeleteModal`, defaulting to retirement.

## Consequences

**Seven page-owned editors, seven undo route handlers.** ADR-0049 replaced a count with a pattern so
that this would not need superseding it, and it has now absorbed three more without amendment. The
revert when E592 is fixed upstream is seven handlers and seven call sites.

**`AdminCrudView` has no `renderEditModal` caller left.** All six admin resources with an editor now
edit on a page, so that prop is optional in the type and unused in the tree. It is deliberately kept:
it costs one optional property, and the create dialogs it is not for are proof that a dialog editor
is still a legitimate shape.

**The matchday form's standing `Callout` becomes two rail banners and a panel note.** The 60-word
block explaining the name, the position and the expected count is split to where each half belongs —
the derivation of the label beside the phase picker, the derivation of the count beside it — which is
the placement `SpieltagFormFields` could not offer.

**`mapSpieltagRefusal` gained the two refusals it was missing.** `REQ-SPIELTAG-004` and
`REQ-RETIRE-005` both post-date the mapping and neither had a German sentence, so each was reaching
the admin as the generic transport message. Found while building the retirement panel that raises the
second of them.

**The threshold now has two readings on record, and the second one has to be applied by judgement.**
That is a real cost of this decision: "does this form have to say more than a dialog can hold" is not
a number, and a reviewer cannot check it the way they could check five fields against a rule. The
mitigation is that the answer is written down per editor — the banner list is the enumeration of what
the form has to say, and an editor whose `banners.ts` is empty is one that did not need a page.

## Alternatives considered

**Leave the matchday editor a dialog, and take the other two to pages.** The consistent reading of
ADR-0050 on its own terms, and refused by my instruction. It would also have left the one
editor of the three whose refusals cannot be pre-empted — the venue and the referee have one each,
the matchday has six — as the only one with no surface to state them on.

**Widen the dialog instead, and put the derivations in a scrolling body.** Rejected on ADR-0040's
original measurement, which was about width before it was about length: a dialog is 311px of content
on a 375px phone, and the two date pickers this form opens are 288px wide on their own.

**Lower ADR-0040's threshold to three fields.** Rejected because it would be the wrong rule stated
more permissively. Nothing about "three" is load-bearing; a create dialog with the same three fields
is correctly a dialog, and a numeric threshold cannot express why.

**Supersede only the one clause of ADR-0050 and leave the rest marked Accepted.** There is no partial
form in this corpus, and the drift ADR-0073 was written to end was exactly an ADR marked Accepted
whose shipped behaviour had moved. Restating the nine live decisions here costs a page and leaves one
record that is true.
