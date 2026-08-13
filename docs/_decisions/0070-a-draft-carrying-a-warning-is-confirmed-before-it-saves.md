# ADR-0070 — A draft carrying a warning is confirmed before it saves, and the undo stays

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-13, taken on the Hinweise inventory that produced the shared
banner list this rule reads.

## Context

[ADR-0041](0041-a-voided-result-is-named-before-it-is-lost.md) rejected a confirmation before a save
and put the safety net after the write instead, as a fifteen-second undo;
[ADR-0049](0049-every-page-owned-editors-undo-is-a-route-handler.md) restates that for every
page-owned editor. Both turn on one measurement: a dialog on every save interrupts a case that is
usually harmless, and the thirty-first is dismissed unread.

**That argument is about a dialog that cannot tell the harmless case from the costly one, and the
page can now tell them apart.** Each editor builds one list of every situation its draft raises,
graded `info`, `warning` or `danger`, and the rail renders what `resolveRailBanners` returns from it
(`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveRailBanners`). A draft with no
warning and no danger is exactly the case ADR-0041 measured. A draft carrying one is not: the grades
are defined at `fl_frontend/src/shared/components/ui/Callout.tsx :: Callout` as a save that may
destroy something and a consequence no later edit reverses on its own.

**The rail is a passive surface, and that is the gap the undo does not close.** Its whole premise is
that a warning can be scrolled past — which is why every inline warning is mirrored into it in the
first place. Undo answers "I did not mean to save that". It does not answer "I did not see that the
fixture I just called off leaves three later ones unoccupied", because by the time the toast is read
the admin has left the page and the sentence naming those fixtures is gone with it.

## Decision

**Submitting a valid form whose resolved Hinweise contain any `warning` or `danger` raises a
confirmation listing exactly those banners, before the write. A clean draft saves straight through,
and the fifteen-second undo stands in both cases.**

- **The dialog's body is the banners themselves**, not a count and not a summary. A dialog that said
  "two Hinweise" would be one more thing to click past, which is the failure ADR-0041 named.
- **`info` never raises it.** An informational banner is a standing property of the record — the
  season is the running one, the squad row is retired — rather than a consequence of this edit.
- **It reads the resolved list**, so what the dialog shows and what the rail shows cannot disagree,
  and a banner another banner supersedes is not raised twice under two wordings.
- **This narrows ADR-0041 and ADR-0049; it reverses neither.** Undo remains the default and remains
  on every save. Neither ADR is superseded, and the condition ADR-0049 carries for reverting the
  undo handlers to server actions is untouched.

## Consequences

**How often the dialog appears is now a property of `banners.ts`.** Grading a situation `warning`
adds a confirmation to every draft that raises it, so the cost of over-grading a standing fact is
paid at the save rather than absorbed by a rail nobody has to read. That is the forcing function
ADR-0041's argument asked for and did not have.

**The save grows a branch, and both routes into it go through the same one.** The submit and the
Ctrl+S shortcut both call the editor's `requestSave`, which either opens the dialog or runs the
write; nothing about the write, the undo payloads or the toast changes on either path.

**A form the browser refuses never reaches the dialog.** HTML constraint validation runs before the
form's action, so the confirmation only ever asks about a draft that would actually be written — it
cannot become a second complaint about a field that is already flagged.

**A new page-owned editor gets this by wiring two lines** — the `blockingBanners` filter and the
modal — which is the same shape all four editors carry, and it is one more thing a new editor can
forget. What makes it visible is that the modal is shared: an editor with no `ConfirmSaveModal` in
its tree is a `grep` away.

**The admin can still save a draft every banner warns about**, and that is deliberate. Several of
the warnings describe legal, intentional states — a Wertung is a cancelled fixture with a decided
score, which the league table counts ([ADR-0019](0019-team-statistics-are-derived-from-spiele.md)).
The dialog exists to make the consequence read, never to refuse it.

## Alternatives considered

**Confirm every save.** Rejected, and nothing here disputes the measurement that rejected it:
most saves destroy nothing, and a dialog paid on all of them is read on none of them.

**Confirm only a `danger`.** Rejected on the grades' own definitions. A `warning` is "something a
save may destroy", so it is precisely a save-time consequence; splitting the two would put
"Speichern löscht das Ergebnis in Spiel 29" inside the dialog and "Eine Mannschaft wird aus Spiel 31
entfernt" outside it, when both are consequences of the same press.

**Replace the undo with the confirmation.** Rejected: the two answer different mistakes. The dialog
helps the admin who did not read the page; the undo helps the admin who did not mean to press the
button, and ADR-0041 chose that case as the one worth designing for. Keeping both costs one dialog
on the drafts that earned it.

**Refuse the save until the warnings are resolved.** Rejected: most of them describe states the
write path accepts on purpose, so a refusal would forbid what the backend permits — which is the
shape [ADR-0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md) keeps on the server
rather than in the form.

**Escalate the rail instead — scroll to Hinweise and flash it on submit.** Rejected: the rail is
sticky only from `xl` up and sits above the fields below it, so the guarantee this would rest on —
that the card is on screen when the admin presses Speichern — does not exist on the viewport where
missing a warning is likeliest.

**Two steps, as `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx :: ConfirmDeleteModal`
has.** Rejected: there the second step exists to make the admin stop before an irreversible write.
Here the danger is already in the draft and the dialog's job is to make it read, so a second step
adds friction without adding anything to read.
