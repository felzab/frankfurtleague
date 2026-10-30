import "server-only";

import * as zod from "zod";

/**
 * Start a change of the typed address for a person who says they cannot sign in, answering its raw links once, for the caller to mail.
 *
 * **Nothing moves here.** Without a `grund` the change asks the address on file first: the caller mails it the request
 * with its stop link, and nothing goes to the new mailbox until that address approves on its account page. With a
 * `grund`, recording how the administrator established who asks, the caller mails the new mailbox its link and the
 * address on file a notice with its stop link; the change then takes effect `ADRESSWECHSEL_WARTEZEIT_TAGE` after the new
 * mailbox confirms. Where the address holds a grant, the change also waits on another administrator's approval, never
 * this one's: `genehmiger_anzahl` counts who could give it, and the grants' outbox tells them (`POST /berechtigungen/abgleich`).
 * The address's live change ends replaced.
 *
 * Refused the administrator's own address (`REQ-PURGE-003`), a grant holder's without an owner's power
 * (`REQ-PURGE-005`), the address on file typed again (`REQ-ADRESSWECHSEL-007`), a new address the ban list holds
 * (`-009`), an address holding nothing a change moves (`-010`), a new address another pupil signs in on where the
 * change moves a pupil (`-006`), a new address any entry names, confirmed or not (`-018`), a grant nobody could approve
 * (`-011`), and a reason naming a person of the records the change would move (`-008`).
 * @summary Start an address change for a person who says they cannot sign in
 */
export const adresswechselPostAdresswechselVerwaltungBodyAdresseMax = 254;

export const adresswechselPostAdresswechselVerwaltungBodyEmailMax = 254;

export const adresswechselPostAdresswechselVerwaltungBodyGrundOneMax = 200;

export const adresswechselPostAdresswechselVerwaltungBodyGrundOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const AdresswechselPostAdresswechselVerwaltungBody = zod
  .object({
    adresse: zod.string().max(adresswechselPostAdresswechselVerwaltungBodyAdresseMax),
    email: zod.string().max(adresswechselPostAdresswechselVerwaltungBodyEmailMax),
    grund: zod.union([
      zod
        .string()
        .min(1)
        .max(adresswechselPostAdresswechselVerwaltungBodyGrundOneMax)
        .regex(adresswechselPostAdresswechselVerwaltungBodyGrundOneRegExp),
      zod.null(),
    ]),
  })
  .describe("The address a change starts on, the address it goes to, and the reason where the address on file is gone.");

/**
 * Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.
 *
 * ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
 * never a hash. `moeglich` where the address holds anything a change moves, a grant included. Stores nothing.
 *
 * Refused as the erasure's reveal is: the administrator's own address (`REQ-PURGE-003`), and an address holding a live
 * grant unless the administrator holds an owner's power (`REQ-PURGE-005`). A change id answers 404 where no change is
 * kept, and `REQ-ADRESSWECHSEL-002` where it ended.
 * @summary Show what an address holds that a change moves, and its live change
 */
export const adresswechselGetAdresswechselVerwaltungAnsichtBodyAdresseOneMax = 254;

export const adresswechselGetAdresswechselVerwaltungAnsichtBodyAdresswechselIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AdresswechselGetAdresswechselVerwaltungAnsichtBody = zod
  .object({
    adresse: zod.union([zod.string().max(adresswechselGetAdresswechselVerwaltungAnsichtBodyAdresseOneMax), zod.null()]).optional(),
    adresswechsel_id: zod
      .union([zod.string().regex(adresswechselGetAdresswechselVerwaltungAnsichtBodyAdresswechselIdOneRegExp), zod.null()])
      .optional(),
  })
  .describe("Exactly one key: the address typed, or the change a page links to.");

/**
 * Record whether the mailbox this link was sent to is the person's: `bestaetigt` confirms it, `abgelehnt` ends the change.
 *
 * **A confirmation moves the person, not a record.** Unless the change waits -- on a waiting time an administrator's
 * start with a reason asked, or on another administrator's approval of the grant it moves -- it takes effect in this
 * transaction: every pupil row, confirmed referee row, confirmed contact seat, registration and grant the address on
 * file holds moves to the new one, asking no consent and writing none, and `wirksam` says so; its completion notice is
 * queued in this transaction for `POST /adresswechsel/sweep/postausgang`. A change that waits is confirmed alone,
 * answering `wirksam_ab` or `genehmigung_offen`.
 * Either answer spends the link, which keeps answering what became of the change.
 *
 * Refuses a token no change holds (`REQ-ADRESSWECHSEL-001`), a link already answered or a change ended
 * (`REQ-ADRESSWECHSEL-002`), and, in the order the link's view ranks its states, a CONFIRMATION through a link mailed to
 * an address the ban list holds now (`-004`), one past its deadline (`-003`), one whose change would replace an address
 * the ban list holds now (`-005`), so a barred person cannot move their records off the address the ban keys on, one
 * moving a pupil onto an address another pupil signs in on (`-006`), one whose address came to hold a grant its approval
 * does not cover (`-015`), one moving a grant onto an address holding one (`-016`), and one whose new address any entry
 * names, confirmed or not, an open grant request among them (`-018`): moving the person onto it would join two people's
 * records. **A decline is refused none of these**: it removes an address nobody proved, out of every log image of the change too.
 *
 * A change whose address has come to hold nothing to move ends discarded, and the press answers `-002`. The codes past
 * `-004` tell a caller what the view's `nicht_bestaetigbar` keeps alike; only the edge keeps them from the link's holder.
 * @summary Confirm or decline a pending address
 */
export const adresswechselPostAdresswechselAntwortBodyTokenMax = 128;

export const AdresswechselPostAdresswechselAntwortBody = zod.object({
  antwort: zod.enum(["bestaetigt", "abgelehnt"]),
  token: zod.string().min(1).max(adresswechselPostAdresswechselAntwortBodyTokenMax),
});

/**
 * Answer what this token opens: the new mailbox's link, the stop link the address on file was mailed, or how either's change ended.
 *
 * **Nothing else about the change**: never a name, either address or the id. A POST that reads, so the token travels in
 * a body and never in a second URL. Refuses only a token no change holds (`REQ-ADRESSWECHSEL-001`); an ended change's
 * links answer `beendet` and how it ended for as long as its record is kept.
 *
 * The new mailbox's side is served in a state: once pressed, `bestaetigt`, or `genehmigung_abgelaufen` where its
 * approval week lapsed unapproved; else `gesperrt` wherever the ban list holds the address the link was mailed to, then
 * `abgelaufen`, then `nicht_bestaetigbar` wherever the press would be refused for the address on file's sake or would
 * find it holding nothing to move, each a state the confirmation is refused in. Those read alike here, though the press
 * answers each by its own code; what keeps the link's holder from telling them apart is the edge, where
 * `nginx/shared/site.conf` routes no public call to this service. The stop side answers the step the change waits on and
 * until when, and never whether it could be confirmed: the stop is refused nothing.
 * @summary What one address link opens
 */
export const adresswechselGetAdresswechselAnsichtBodyTokenMax = 128;

export const AdresswechselGetAdresswechselAnsichtBody = zod.object({
  token: zod.string().min(1).max(adresswechselGetAdresswechselAnsichtBodyTokenMax),
});

/**
 * Stop the change the address on file was told of: its new address goes, out of every log image of the change too.
 *
 * **Refused nothing but a token no change holds** (`REQ-ADRESSWECHSEL-001`) **and a change ended** (`-002`): a stop
 * hands nothing over, so it answers past every deadline, a barred address's holder too, until the change ends.
 * @summary Stop a pending address change
 */
export const adresswechselPostAdresswechselStoppBodyTokenMax = 128;

export const AdresswechselPostAdresswechselStoppBody = zod.object({
  token: zod.string().min(1).max(adresswechselPostAdresswechselStoppBodyTokenMax),
});

/**
 * End a bounded share of the live changes whose waiting step lapsed, and make the due ones take effect.
 *
 * **A lapsed change** -- its link, the approval it asked of the address on file, or its grant's approval by another
 * administrator -- ends as `abgelaufen`: its address and reason out of the record and every log image of it
 * (`entfernt`). **A due change**, one whose waiting time has ended and whose grant's move, where its address still
 * holds the grant, was approved, is judged again as its confirmation was: a ban on either address, another pupil
 * signing in on the new one, a grant its approval does not cover, a grant at the new address, or nothing left to move
 * ends it discarded, and
 * `verworfen` counts it, its new address queued to be told it did not take effect and never why; otherwise
 * everything the replaced address holds moves, and `wirksam` counts it, its completion notice queued. The notices are
 * `POST /adresswechsel/sweep/postausgang`'s to claim, queued in each change's own transaction, so none rides on this answer.
 *
 * Each change is handled in a transaction of its own that judges it again, so one confirmed, stopped, discarded or
 * replaced since this call read it is left standing. **A pass is a run of calls, each handing the next the `nach` the last
 * answered**, the first naming none; it ends at the call answering `nach` null. A call reaches at most a fixed share of the
 * changes after `nach`, in `_id` order, and the pass holds no state on the server. A change whose handling fails is
 * logged by its id and passed, holding back nobody behind it; it stays due, and the next pass tries it again. Where the
 * request's deadline cuts the call, it stops at that change, warns once, and answers what it did. `verbleibend` counts
 * the changes standing due after the call, so it is no stopping condition.
 * @summary End the lapsed address changes, and make the due ones take effect
 */
export const adresswechselSweepAdresswechselQueryNachOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AdresswechselSweepAdresswechselQueryParams = zod.object({
  nach: zod.union([zod.string().regex(adresswechselSweepAdresswechselQueryNachOneRegExp), zod.null()]).optional(),
});

/**
 * Answer the new address of the live change the new mailbox's link token or the change's id names, folded to the sign-in identifier.
 *
 * For the frontend's server alone, which asks its sign-in store whether an account stands there before a press, a link's
 * view or an approval; the link's own view never serves the address. A token or id naming no live change -- unknown,
 * ended, or the stop link's token -- is answered null rather than refused, so a lapsed or answered link costs no
 * error. Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the token travels in the body, and the
 * address only in the answer.
 * @summary Say which address a live change would move to
 */
export const adresswechselGetAdresswechselAdresseBodyAdresswechselIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const adresswechselGetAdresswechselAdresseBodyTokenOneMax = 128;

export const AdresswechselGetAdresswechselAdresseBody = zod
  .object({
    adresswechsel_id: zod.union([zod.string().regex(adresswechselGetAdresswechselAdresseBodyAdresswechselIdOneRegExp), zod.null()]).optional(),
    token: zod.union([zod.string().min(1).max(adresswechselGetAdresswechselAdresseBodyTokenOneMax), zod.null()]).optional(),
  })
  .describe("Exactly one key: the new mailbox's link token, or the change an approval names.");

/**
 * Remove each named notice the named claim still holds, and nothing else.
 *
 * A notice the claim does not hold -- unknown, removed already, or claimed since by another call after this claim
 * lapsed -- is left alone and counted in `ignoriert`. A repeated id counts once. One transaction, imageless: a row
 * names addresses, and the log keeps no image of its removal.
 * @summary Remove the delivered notices a claim holds
 */

export const adresswechselPostAdresswechselZugestelltBodyIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const adresswechselPostAdresswechselZugestelltBodyIdsMax = 1024;

export const AdresswechselPostAdresswechselZugestelltBody = zod.object({
  beanspruchung: zod.string().min(1),
  ids: zod
    .array(zod.string().regex(adresswechselPostAdresswechselZugestelltBodyIdsItemRegExp))
    .min(1)
    .max(adresswechselPostAdresswechselZugestelltBodyIdsMax),
});

/**
 * Discard the change this id names: its links open nothing to press, and the address on file stays.
 *
 * **Its address goes from the action log too**: every image the log holds of the change
 * loses its new address and reason, the rest of each image standing. Journalled as the stop is, so a restore does not
 * bring back a change confirmed in its waiting time to take effect. Nothing is mailed. Acts on the change the id names
 * alone, so a page showing a change since replaced discards nothing.
 *
 * Refused as the start is about who asks (`REQ-PURGE-003`, `REQ-PURGE-005`), and where the change ended
 * (`REQ-ADRESSWECHSEL-002`); 404 for an id naming no change.
 * @summary Discard a pending address change
 */
export const adresswechselDeleteAdresswechselPathAdresswechselIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AdresswechselDeleteAdresswechselParams = zod.object({
  adresswechsel_id: zod.string().regex(adresswechselDeleteAdresswechselPathAdresswechselIdRegExp),
});

/**
 * Mint the new mailbox a fresh link for the change this id names, answering the raw token once, for the caller to mail.
 *
 * The previous link stops working at once and the delivery state of the message it went out in goes with it; the
 * deadline restarts now. The stop link stays, so the address on file is mailed nothing again. A lapsed link is no
 * refusal while the change stands, which is until the next hourly pass ends it. Acts
 * on the change the id names alone, so a page showing a change since replaced re-sends nothing.
 *
 * Refused as the start is about who asks (`REQ-PURGE-003`, `REQ-PURGE-005`), where the ban list holds the pending address
 * (`REQ-ADRESSWECHSEL-009`), where another pupil has come to sign in on it (`-006`), where an entry has come to name it,
 * confirmed or not (`-018`), where a grant's approval week has passed (`-003`), and where the change ended (`-002`). 404 for
 * an id naming no change, and unless the change waits on the new mailbox: one awaiting the address on file's approval,
 * or confirmed, has no link to re-send.
 * @summary Send a pending address a fresh link
 */
export const adresswechselEinladenAdresswechselPathAdresswechselIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AdresswechselEinladenAdresswechselParams = zod.object({
  adresswechsel_id: zod.string().regex(adresswechselEinladenAdresswechselPathAdresswechselIdRegExp),
});

/**
 * Approve the move of an administrator's grant with the change of their address, the second pair of eyes the change waits on.
 *
 * Where the new mailbox has confirmed and no waiting time remains, the change takes effect in this transaction: the grant
 * is revoked at the replaced address and granted at the new one under this administrator's name, announced to every
 * administrator as a grant and a revoke are, and everything else the address holds moves, its completion notice queued
 * in this transaction. Otherwise the approval is recorded and the change takes effect at its confirmation
 * or at the end of its waiting time. **An approval refused writes nothing**: the change stands unapproved.
 *
 * Refused where the change asks no approval or was given it (`REQ-ADRESSWECHSEL-012`), where its seven days have passed
 * (`-003`), to the changed address and to the administrator who started it (`-013`), to anyone but an owner, signed in
 * since becoming one, where the grant is an owner's (`-014`), and where the change ended (`-002`); and, where it would
 * take effect, as the confirmation is (`-004`, `-005`, `-006`, `-015`, `-016`, `-018`). A change whose address has come to hold
 * nothing to move ends discarded, its new address told it did not take effect, answering `-010`. 404 for an id naming no
 * change. A sign-in or confirmation older than
 * `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as a grant's is.
 * @summary Approve the move of an administrator's access with their address change
 */
export const adresswechselPostAdresswechselGenehmigungPathAdresswechselIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AdresswechselPostAdresswechselGenehmigungParams = zod.object({
  adresswechsel_id: zod.string().regex(adresswechselPostAdresswechselGenehmigungPathAdresswechselIdRegExp),
});

/**
 * List what administrators changed, newest first; `vollstaendig` is false on a cut answer.
 *
 * Admin-tier twice over: every recorded write across every collection is here, public or not,
 * and each row names the administrator behind it — `null` beside `actor.email_gesperrt` where the
 * ban list holds that address, as no barred address is served in plain.
 *
 * `collection`, `operation` and `herkunft` each take a comma-joined selection, or the parameter
 * repeated, and all three narrow this read. `herkunft` names no stored field: it is the category the
 * actor's kind is filed under, `person` covering every kind that authenticates somebody.
 *
 * `anzahl_je_collection`, `anzahl_je_operation` and `anzahl_je_herkunft` count every row `trace_id`
 * and `document_id` leave, with the other two facets applied and their own ignored, so a caller
 * narrowed to one area still knows what asking for another would fetch; a value nothing was recorded
 * under is absent rather than zero. While either of those two terms is in force the counts are that
 * trace's or that document's and not the log's.
 *
 * `trace_id` selects one request's whole fan-out, which this read serves under the same cap as any
 * other; a write made outside a request carries the sentinel `SYSTEM` there, which gathers every
 * such write rather than one (`docs/glossary.md :: Vorgangsnummer`).
 * @summary List recorded admin actions
 */
export const aktionenGetAktionenQueryLimitDefault = 1024;
export const aktionenGetAktionenQueryLimitMax = 1024;

export const aktionenGetAktionenQueryOrderDefault = `desc`;

export const AktionenGetAktionenQueryParams = zod.object({
  collection: zod.string().optional(),
  operation: zod.string().optional(),
  herkunft: zod.string().optional(),
  trace_id: zod.union([zod.string(), zod.null()]).optional(),
  document_id: zod.union([zod.string(), zod.null()]).optional(),
  limit: zod.int().min(1).max(aktionenGetAktionenQueryLimitMax).default(aktionenGetAktionenQueryLimitDefault),
  order: zod.enum(["asc", "desc"]).default(aktionenGetAktionenQueryOrderDefault),
});

/**
 * One row with the document its write replaced, which the list withholds.
 *
 * The read a restore of one write would start from, so the image is served as recorded, every
 * address in it included; the actor is withheld as the list withholds it.
 * @summary One recorded admin action
 */
export const aktionenGetAktionByIdPathAktionIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AktionenGetAktionByIdParams = zod.object({
  aktion_id: zod.string().regex(aktionenGetAktionByIdPathAktionIdRegExp),
});

/**
 * Grant an address access to the administration, as `administration`, or ask another administrator to. No request grants `owner`.
 *
 * **Four eyes**: where another administrator could approve it -- a live, unbarred grant in effect now, neither this administrator
 * nor the address -- the grant is not made: a request is, answered with `beantragt` set and its id, and the grant takes effect
 * only on that approval (`POST /berechtigungen/antraege/{antrag_id}/genehmigung`). A lone administrator grants alone.
 *
 * The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
 * grant already holds the address (`REQ-BERECHTIGUNG-001`) -- a dead row of another spelling blocks nothing -- where the ban list
 * holds it (`REQ-BERECHTIGUNG-003`), and where a request about it waits already (`REQ-BERECHTIGUNG-008`). The grant takes effect on
 * the next request, for a session signed in after it alone -- an older one is refused `REQ-AUTH-007` on every admin-tier route -- and
 * its announcement is queued in the same transaction for `POST /berechtigungen/abgleich` to hand out. Like a revoke and a tier
 * change, it takes a passkey sign-in or confirmation no older than `ENROLMENT_WINDOW_MINUTES`, refused `REQ-AUTH-009` otherwise.
 * @summary Grant access to the administration
 */
export const berechtigungenPostBerechtigungBodyEmailMax = 254;

export const BerechtigungenPostBerechtigungBody = zod.object({
  email: zod.string().max(berechtigungenPostBerechtigungBodyEmailMax),
});

/**
 * Remove each named change from the queue, where the named claim still holds it, and nothing else.
 *
 * A change the claim does not hold -- unknown, removed already, or claimed since by another call after this claim lapsed -- is
 * left alone and counted in `ignoriert`, so a caller can mark as told only what the server itself holds as queued under its own
 * claim. A repeated id counts once. One transaction, recorded under the system actor.
 * @summary Remove the announced changes a claim holds
 */

export const berechtigungenPostBerechtigungenAngekuendigtBodyIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const berechtigungenPostBerechtigungenAngekuendigtBodyIdsMax = 1024;

export const BerechtigungenPostBerechtigungenAngekuendigtBody = zod.object({
  beanspruchung: zod.string().min(1),
  ids: zod
    .array(zod.string().regex(berechtigungenPostBerechtigungenAngekuendigtBodyIdsItemRegExp))
    .min(1)
    .max(berechtigungenPostBerechtigungenAngekuendigtBodyIdsMax),
});

/**
 * Refuse a request, or withdraw one's own: it is removed, and nothing it asked for happens. HARD, no soft form.
 *
 * Decided by whoever may approve it, refused with the approval's own codes otherwise (`REQ-BERECHTIGUNG-009`, `-010`, `-011`), and
 * withdrawn by the administrator who made it, whatever their tier now. 404 for an id naming no request, a request decided, withdrawn or
 * lapsed among them. A restore from a snapshot taken before it brings the request back only until the replay of its journal line.
 *
 * A refusal queues, in the same transaction, a notice to the request's requester naming the address and tier it asked for and
 * nobody who refused it, for `POST /berechtigungen/abgleich` to hand out; a withdrawal tells nobody.
 * @summary Refuse a grant or a promotion another administrator asked for, or withdraw one's own
 */
export const berechtigungenDeleteAntragPathAntragIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BerechtigungenDeleteAntragParams = zod.object({
  antrag_id: zod.string().regex(berechtigungenDeleteAntragPathAntragIdRegExp),
});

/**
 * Approve a request, the second pair of eyes a grant or a promotion waits on.
 *
 * The grant is made, or the tier moved, and the request removed, in one transaction, the change announced to every
 * administrator as one made directly is, under this administrator's name.
 *
 * Refused to the address the request is about and to the administrator who made it (`REQ-BERECHTIGUNG-009`), to anyone but an
 * owner, signed in since becoming one, for a promotion (`-010`), to an administrator whose grant, or owner's tier, took effect after
 * the request (`-011`), and where the requester does not hold that tier since before it, revoked, demoted or barred since
 * (`-012`); and, as the direct act would be, where the address holds a grant by now (`-001`) or is on the ban list (`-003`). 404 for
 * an id naming no request, a request decided, withdrawn or lapsed among them, and for a promotion whose grant has gone. A promotion
 * whose grant is an owner's already removes the request and changes nothing. A sign-in or confirmation older than
 * `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as a grant's is.
 * @summary Approve a grant or a promotion another administrator asked for
 */
export const berechtigungenPostAntragGenehmigungPathAntragIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BerechtigungenPostAntragGenehmigungParams = zod.object({
  antrag_id: zod.string().regex(berechtigungenPostAntragGenehmigungPathAntragIdRegExp),
});

/**
 * Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `REQ-AUTH-006` on its next request.
 *
 * Only an `owner` revokes (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before anything
 * about the target is answered; an owner's sign-in older than the moment they became one is refused the same. 404 where no grant
 * has the id. Refused for an `owner` row (`REQ-BERECHTIGUNG-002`), which is made an
 * administrator first, and where fewer than two live, unbarred grants would remain (`REQ-BERECHTIGUNG-004`). The removal's
 * announcement is queued in the same transaction, after any change to the row made in the database and not yet announced. A sign-in
 * or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as the grant's is.
 * @summary Revoke access to the administration
 */
export const berechtigungenDeleteBerechtigungPathBerechtigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BerechtigungenDeleteBerechtigungParams = zod.object({
  berechtigung_id: zod.string().regex(berechtigungenDeleteBerechtigungPathBerechtigungIdRegExp),
});

/**
 * Make an administrator an owner, or an owner an administrator; an owner steps down by naming their own grant.
 *
 * Only an `owner` changes a tier (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before
 * anything about the target is answered; an owner's sign-in older than the moment they became one is refused the same.
 *
 * **Four eyes on a promotion**: where another owner could approve it -- a live, unbarred `owner` grant in effect now, neither this
 * owner nor the promoted address -- the tier is not moved: a request is, answered with `beantragt` set, and the promotion takes
 * effect only on that approval (`POST /berechtigungen/antraege/{antrag_id}/genehmigung`). A lone owner promotes alone. A demotion
 * and a step-down take effect at once.
 *
 * A promotion holds for a sign-in after it alone: the promoted administrator's older sessions keep administering and take no owner's
 * step until they sign in again. A demotion takes the tier from every session at once. 404 where no live grant has the id. A
 * promotion of an address on the ban list is refused (`REQ-BERECHTIGUNG-003`), one whose request waits already
 * (`REQ-BERECHTIGUNG-008`), and a demotion leaving no live, unbarred owner (`REQ-BERECHTIGUNG-007`). Naming the tier the grant holds
 * changes nothing and answers 200. The change reaches the next request; its announcement is queued in the same transaction, after
 * any change to the row made in the database and not yet announced, and a grant found that way is stamped `gefunden_am` as
 * `POST /berechtigungen/abgleich` stamps one. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused
 * `REQ-AUTH-009`, as the grant's is.
 * @summary Change a grant between administrator and owner
 */
export const berechtigungenPatchBerechtigungPathBerechtigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BerechtigungenPatchBerechtigungParams = zod.object({
  berechtigung_id: zod.string().regex(berechtigungenPatchBerechtigungPathBerechtigungIdRegExp),
});

export const BerechtigungenPatchBerechtigungBody = zod.object({
  verwaltung: zod.enum(["owner", "administration"]),
});

/**
 * Every application, newest first, narrowable by season and by any number of the three statuses.
 *
 * Decided ones stay listed: what the league turned down, and why, is the record the decision was
 * taken against. `vollstaendig` is false where more rows exist than one read serves. A decision's
 * administrator is `null` beside `entscheidung.von_gesperrt` where the ban list holds that
 * address, as no barred address is served in plain.
 *
 * `saisonbezug` says which side of `saison_id` this read covers — `diese_saison` for that season,
 * `andere_saison` for every other one — and is ignored without a `saison_id` to stand against.
 * Both values is every season, as omitting the parameter is; `saison_id` alone is that season.
 *
 * `anzahl_je_status` counts every status over the seasons this request selected and never over the
 * statuses it named, and `anzahl_je_saisonbezug` counts each side of the season relation over those
 * statuses and never over the relation, so a caller narrowed to one of either still knows what
 * asking for the other would fetch. Repeating a parameter and comma-joining its values are one
 * request; omitting one is every value, and sending it empty is too.
 *
 * `dubletten_schluessel` names every key two or more OPEN applications share, over every season the
 * request selected rather than over the rows served, so a colliding pair the cap parted is named at
 * both ends; a key carries its own season, so no selection can part one. A key
 * is the season and the club id, or the season and the upper-cased Kürzel, parted by the word
 * `team` or `kuerzel`; a caller composes a served row's own key and marks the row where the two
 * match.
 * @summary List Bewerbungen
 */
export const bewerbungenGetBewerbungenQueryLimitDefault = 1024;
export const bewerbungenGetBewerbungenQueryLimitMax = 1024;

export const bewerbungenGetBewerbungenQuerySortByDefault = `eingereicht_am`;
export const bewerbungenGetBewerbungenQueryOrderDefault = `desc`;

export const BewerbungenGetBewerbungenQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  saisonbezug: zod.string().optional(),
  status: zod.string().optional(),
  limit: zod.int().min(1).max(bewerbungenGetBewerbungenQueryLimitMax).default(bewerbungenGetBewerbungenQueryLimitDefault),
  sort_by: zod.literal("eingereicht_am").default(bewerbungenGetBewerbungenQuerySortByDefault).meta({ title: "Sort By" }),
  order: zod.enum(["asc", "desc"]).default(bewerbungenGetBewerbungenQueryOrderDefault),
});

/**
 * Store one school's application to play one season as submitted, and mint one confirmation link per contact person.
 *
 * Everything the league decides -- `status`, `eingereicht_am`, `entscheidung` and each consent's
 * scope, source and date -- is written here and never taken off the payload. The three raw tokens are answered
 * for the caller to mail and stored only as hashes; the response is the one place outside the recipients' inboxes
 * they ever exist.
 *
 * An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * application it holds and stores none: fresh links where no message to any seat is known to have
 * reached its inbox, none otherwise. The same key over other details is refused (`REQ-BEWERBUNG-015`).
 *
 * An address the ban list holds, on any seat, is refused (`REQ-BEWERBUNG-018`) on a first press and on a
 * replay alike, before any link is minted.
 *
 * A seat naming a consent wording other than the one the form now shows is refused (`REQ-EINWILLIGUNG-001`),
 * and only once the key has been looked up: a stored key is answered whatever wording it names.
 * @summary Submit a Bewerbung
 */
export const bewerbungenPostBewerbungBodyKaderGuteSpielerMin = 0;
export const bewerbungenPostBewerbungBodyKaderGuteSpielerMax = 200;

export const bewerbungenPostBewerbungBodyKaderVoraussichtlicheGroesseMax = 200;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonEinwilligungTextVersionMax = 64;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonEmailMax = 254;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonNachnameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonVornameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteStellvertretungEinwilligungTextVersionMax = 64;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungEmailMax = 254;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungNachnameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteStellvertretungTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostBewerbungBodyKontakteStellvertretungVornameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteTrainerEinwilligungTextVersionMax = 64;

export const bewerbungenPostBewerbungBodyKontakteTrainerEmailMax = 254;

export const bewerbungenPostBewerbungBodyKontakteTrainerNachnameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteTrainerNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteTrainerTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostBewerbungBodyKontakteTrainerVornameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteTrainerVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodySaisonIdMin = 4;
export const bewerbungenPostBewerbungBodySaisonIdMax = 4;

export const bewerbungenPostBewerbungBodySchuleOneAddressHausnummerMax = 16;

export const bewerbungenPostBewerbungBodySchuleOneAddressHausnummerRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const bewerbungenPostBewerbungBodySchuleOneAddressPlzRegExp = new RegExp("^[0-9]{5}$");
export const bewerbungenPostBewerbungBodySchuleOneAddressStadtMax = 80;

export const bewerbungenPostBewerbungBodySchuleOneAddressStadtteilMax = 80;

export const bewerbungenPostBewerbungBodySchuleOneAddressStrasseMax = 120;

export const bewerbungenPostBewerbungBodySchuleOneFullNameMax = 120;

export const bewerbungenPostBewerbungBodySchuleOneFullNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const bewerbungenPostBewerbungBodySchuleOneShorthandRegExp = new RegExp("^\\s*[A-Za-z]{3}\\s*$");
export const bewerbungenPostBewerbungBodySchuleOneTeamNameMax = 60;

export const bewerbungenPostBewerbungBodySchuleOneTeamNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const bewerbungenPostBewerbungBodySchuleOneWebsiteUrlOneMax = 300;

export const bewerbungenPostBewerbungBodyStufengroesseMax = 999;

export const bewerbungenPostBewerbungBodyTeamIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const bewerbungenPostBewerbungBodyTrikotVorhandenerSatzMax = 500;

export const bewerbungenPostBewerbungBodyWunschgegnerOneMax = 120;

export const bewerbungenPostBewerbungBodyWunschgegnerOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const BewerbungenPostBewerbungBody = zod
  .object({
    kader: zod.object({
      gute_spieler: zod.int().min(bewerbungenPostBewerbungBodyKaderGuteSpielerMin).max(bewerbungenPostBewerbungBodyKaderGuteSpielerMax),
      voraussichtliche_groesse: zod.int().min(1).max(bewerbungenPostBewerbungBodyKaderVoraussichtlicheGroesseMax),
    }),
    kontakte: zod
      .object({
        ansprechperson: zod
          .object({
            einwilligung: zod
              .object({
                erteilt: zod.literal(true).meta({ title: "Erteilt" }),
                text_version: zod.string().min(1).max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonEinwilligungTextVersionMax),
              })
              .describe(
                "What the applicant agreed to, and nothing about how the record of it is composed.\n\n`umfang` and `datum` are the SERVER's: a client offered them could claim the person's own\nanswer, or backdate a record.",
              ),
            email: zod.string().max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonEmailMax),
            nachname: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonNachnameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteAnsprechpersonNachnameRegExp),
            telefon: zod.string().regex(bewerbungenPostBewerbungBodyKontakteAnsprechpersonTelefonRegExp),
            vorname: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonVornameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteAnsprechpersonVornameRegExp),
          })
          .describe(
            "One of the three people, as a member of the public submits them.\n\nNo birthdate: each types their own on the confirmation page, so\nthe key is refused outright rather than accepted as a null.",
          ),
        stellvertretung: zod
          .object({
            einwilligung: zod
              .object({
                erteilt: zod.literal(true).meta({ title: "Erteilt" }),
                text_version: zod.string().min(1).max(bewerbungenPostBewerbungBodyKontakteStellvertretungEinwilligungTextVersionMax),
              })
              .describe(
                "What the applicant agreed to, and nothing about how the record of it is composed.\n\n`umfang` and `datum` are the SERVER's: a client offered them could claim the person's own\nanswer, or backdate a record.",
              ),
            email: zod.string().max(bewerbungenPostBewerbungBodyKontakteStellvertretungEmailMax),
            nachname: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteStellvertretungNachnameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteStellvertretungNachnameRegExp),
            telefon: zod.string().regex(bewerbungenPostBewerbungBodyKontakteStellvertretungTelefonRegExp),
            vorname: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteStellvertretungVornameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteStellvertretungVornameRegExp),
          })
          .describe(
            "One of the three people, as a member of the public submits them.\n\nNo birthdate: each types their own on the confirmation page, so\nthe key is refused outright rather than accepted as a null.",
          ),
        trainer: zod
          .object({
            einwilligung: zod
              .object({
                erteilt: zod.literal(true).meta({ title: "Erteilt" }),
                text_version: zod.string().min(1).max(bewerbungenPostBewerbungBodyKontakteTrainerEinwilligungTextVersionMax),
              })
              .describe(
                "What the applicant agreed to, and nothing about how the record of it is composed.\n\n`umfang` and `datum` are the SERVER's: a client offered them could claim the person's own\nanswer, or backdate a record.",
              ),
            email: zod.string().max(bewerbungenPostBewerbungBodyKontakteTrainerEmailMax),
            nachname: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteTrainerNachnameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteTrainerNachnameRegExp),
            telefon: zod.string().regex(bewerbungenPostBewerbungBodyKontakteTrainerTelefonRegExp),
            vorname: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteTrainerVornameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteTrainerVornameRegExp),
          })
          .describe(
            "One of the three people, as a member of the public submits them.\n\nNo birthdate: each types their own on the confirmation page, so\nthe key is refused outright rather than accepted as a null.",
          ),
        trainer_ist_zugleich: zod.union([zod.enum(["ansprechperson", "stellvertretung"]), zod.null()]),
      })
      .describe(
        "The three people an application is reached through, all three REQUIRED and non-null.\n\nUnlike the junction payload, whose nulls keep a row an erasure emptied editable: an application\nis the form those three filled in, and there is nothing yet to erase.",
      ),
    saison_id: zod.string().min(bewerbungenPostBewerbungBodySaisonIdMin).max(bewerbungenPostBewerbungBodySaisonIdMax),
    schule: zod.union([
      zod
        .object({
          address: zod
            .object({
              hausnummer: zod
                .string()
                .max(bewerbungenPostBewerbungBodySchuleOneAddressHausnummerMax)
                .regex(bewerbungenPostBewerbungBodySchuleOneAddressHausnummerRegExp),
              plz: zod.string().regex(bewerbungenPostBewerbungBodySchuleOneAddressPlzRegExp),
              stadt: zod.string().min(1).max(bewerbungenPostBewerbungBodySchuleOneAddressStadtMax),
              stadtteil: zod.string().min(1).max(bewerbungenPostBewerbungBodySchuleOneAddressStadtteilMax),
              strasse: zod.string().min(1).max(bewerbungenPostBewerbungBodySchuleOneAddressStrasseMax),
            })
            .describe(
              "The school's address, with the Stadtteil REQUIRED.\n\nIts own subclass rather than a change to `FLAddressPayload`, which an admin address shares: a\nvenue can genuinely lack a district, and a Frankfurt school does not.",
            ),
          full_name: zod
            .string()
            .min(1)
            .max(bewerbungenPostBewerbungBodySchuleOneFullNameMax)
            .regex(bewerbungenPostBewerbungBodySchuleOneFullNameRegExp),
          schulform: zod.enum(["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]),
          shorthand: zod.string().regex(bewerbungenPostBewerbungBodySchuleOneShorthandRegExp),
          team_name: zod
            .string()
            .min(1)
            .max(bewerbungenPostBewerbungBodySchuleOneTeamNameMax)
            .regex(bewerbungenPostBewerbungBodySchuleOneTeamNameRegExp),
          website_url: zod.union([zod.string().max(bewerbungenPostBewerbungBodySchuleOneWebsiteUrlOneMax), zod.null()]),
        })
        .describe(
          "The club a new school proposes, bounded and stripped for the write side.\n\nA subclass rather than a second declaration, as `FLKontaktpersonPayload` is: the field set is the\nstored block's, and two spellings of it would drift on every field they share.",
        ),
      zod.null(),
    ]),
    stufengroesse: zod.int().min(1).max(bewerbungenPostBewerbungBodyStufengroesseMax),
    team_id: zod.union([zod.string().regex(bewerbungenPostBewerbungBodyTeamIdOneRegExp), zod.null()]),
    trikot: zod.object({
      vorhandener_satz: zod.string().max(bewerbungenPostBewerbungBodyTrikotVorhandenerSatzMax),
      wunschfarbe: zod.enum([
        "schwarz",
        "weiss",
        "grau",
        "braun",
        "bordeaux",
        "rot",
        "koralle",
        "orange",
        "gold",
        "gelb",
        "limette",
        "hellgruen",
        "gruen",
        "smaragd",
        "tuerkis",
        "cyan",
        "hellblau",
        "meerblau",
        "blau",
        "dunkelblau",
        "flieder",
        "violett",
        "magenta",
        "rosa",
      ]),
    }),
    wunschgegner: zod
      .union([
        zod.string().max(bewerbungenPostBewerbungBodyWunschgegnerOneMax).regex(bewerbungenPostBewerbungBodyWunschgegnerOneRegExp),
        zod.null(),
      ])
      .optional(),
  })
  .describe(
    "One school's application, as the public form submits it.\n\n`status`, `eingereicht_am` and `entscheidung` are on no payload: the server sets all three, so a\nclient can neither arrive already accepted nor backdate its own submission.",
  );

/**
 * Record one person's own answer for the seat their link opens, and for a second seat the form said they hold.
 *
 * A consent writes their date of birth, the stamp, `person` and the wording they were shown in one update, each
 * choice with its evidence, and leaves who seated them as it stands; a decline empties their slot and redacts
 * every log image holding it, as an erasure does. Refuses, in this order: a token no seat holds (`REQ-BEWERBUNG-009`),
 * a link whose deadline has passed or whose application was decided (`REQ-BEWERBUNG-010`), a seat already answered
 * (`REQ-BEWERBUNG-011`), a consent naming any label but the one the view answered as `laufende_fassung` for this link
 * (`REQ-EINWILLIGUNG-001`), a consent from an address the ban list holds now, whenever the link was minted
 * (`REQ-BEWERBUNG-020`), an age outside the span the seats this person holds ask for (`REQ-BEWERBUNG-012`), and a
 * media consent from a person below `medien_mindestalter` (`REQ-EINWILLIGUNG-002`) -- the last four judged before
 * anything is written, so a reloaded page or a mistyped year spends nothing. A decline
 * stores no label and is taken from a barred address too: it empties the seat.
 *
 * The answer also carries what the two outbound messages are composed from, the Ansprechperson seat's own
 * mailbox among it: this is a server-to-server response, and a caller putting it in front of a browser
 * would hand one contact person another's address.
 *
 * A link on a team's season row (`quelle: saison`) is answered the same way on that row, refused in the same order but
 * for `REQ-BEWERBUNG-010`, nothing deciding a season row, and its answer carries nothing to compose a message from. Its
 * own deadline passed is `REQ-KONTAKT-004`, and a consent once its season has ended or its team has left it is
 * `REQ-KONTAKT-006`, a Widerspruch being taken all the same. A Widerspruch there also voids the seat's links on the
 * team's match confirmations of that season, answered and closed ones too, takes those links and their mails' delivery
 * records out of the confirmations' log images, and takes every reason its person typed answering a match confirmation,
 * from any seat they held, from its row and its log images, the answer standing.
 * @summary Confirm or decline one seat of a Bewerbung or of a team's season row
 */
export const bewerbungenPostEinwilligungBodyGeburtsdatumOneRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const bewerbungenPostEinwilligungBodyGeburtsdatumThreeRegExp = new RegExp("^\\s*$");
export const bewerbungenPostEinwilligungBodyTextVersionMax = 64;

export const bewerbungenPostEinwilligungBodyTokenMax = 128;

export const BewerbungenPostEinwilligungBody = zod
  .object({
    antwort: zod.enum(["erteilt", "abgelehnt"]),
    geburtsdatum: zod.union([
      zod.string().regex(bewerbungenPostEinwilligungBodyGeburtsdatumOneRegExp),
      zod.null(),
      zod.string().regex(bewerbungenPostEinwilligungBodyGeburtsdatumThreeRegExp),
    ]),
    medien: zod.boolean(),
    text_version: zod.string().min(1).max(bewerbungenPostEinwilligungBodyTextVersionMax),
    token: zod.string().min(1).max(bewerbungenPostEinwilligungBodyTokenMax),
    whatsapp: zod.boolean(),
  })
  .describe("One person's answer for one seat: the consent, or a decline that empties their slot.");

/**
 * Answer what the page renders for the seat this token opens, and no contact record (`READ-BEWERBUNG-002`).
 *
 * The seat's state, the school, the season, the role, and `zugleich_rolle`: the
 * second seat the same person holds, which an answer on this link writes too, or null. Never the holder's name: the
 * link went to an address nobody has confirmed, which behind a typo is a stranger's.
 * `mindestalter` is the age this link's person has to reach, over both seats where they hold two, so the page offers
 * exactly the dates the answer will take. `laufende_fassung` is the label of the page the person is shown and their
 * answer must name: the applicant's where the applicant named them in every seat the link answers, else the one for a
 * person the administration seated.
 * A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
 * seat holds (`REQ-BEWERBUNG-009`), an open link whose seat holds nobody among them: a confirmed, declined or
 * expired link is SERVED in that state rather than refused, so a reopened link shows what became of it. The state
 * is `gesperrt`, ahead of every other, wherever the ban list holds an address a consent on this link would be
 * refused for (`REQ-BEWERBUNG-020`), so the page offers a barred person nothing to press.
 *
 * The same token may open a seat an administrator entered on a team's season row (`quelle: saison`): `schule` is then
 * the name the club carries that season, and the link is over once its seat's own deadline has passed. Before that, a
 * season that has ended or a team that has left it answers `saison_vorbei`: the link takes a Widerspruch and no consent.
 * @summary What one confirmation link opens
 */
export const bewerbungenGetEinwilligungAnsichtBodyTokenMax = 128;

export const BewerbungenGetEinwilligungAnsichtBody = zod
  .object({
    token: zod.string().min(1).max(bewerbungenGetEinwilligungAnsichtBodyTokenMax),
  })
  .describe("A POST that reads: the token travels in a body, never in a second URL.");

/**
 * Return one season's application window, or that it records none; 404 only where no season carries the id.
 *
 * A CLOSED window is served rather than hidden: the page says the deadline has passed, which a
 * 404 could not tell from a mistyped id. A season with no window recorded is served for the same
 * reason, and its existence is the whole of what this tier learns about it.
 * @summary One Saison's application window
 */
export const BewerbungenGetFensterParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Answer whether any club holds this three-letter code.
 *
 * Retired clubs COUNT and no club is named: `uniq_shorthand` spans the collection, and an answer
 * naming the holder would publish which schools have left (`READ-BEWERBUNG-001`).
 * @summary Whether a Kürzel is already a club's
 */
export const BewerbungenGetKuerzelParams = zod.object({
  shorthand: zod.string(),
});

/**
 * Run the six retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.
 *
 * The reminder clock stamps `erinnert_am` and mints a fresh link per seat BEFORE answering, so a failed mail costs one
 * person one reminder and never a repeat; the first link stays valid beside the fresh one. A seat whose last message the
 * mail provider refused is not chased at all, its one reminder buying nothing. A seat whose address the ban list holds is
 * sent nothing and has nothing written: it stays due, so every pass asks the ban list for it again until its deadline, and
 * reminds it once a lift comes first; each pass logs how many mailboxes it withheld, never which. The fourteen-day clock only
 * LISTS its candidates here, each saying whether its notice has already gone out -- the caller mails the rest, stamps the
 * delivered ones through `/angekuendigt` and erases every announced one through `/loeschen`. An application whose
 * Ansprechperson the provider refuses is listed by neither: it is held past its deadline for an administrator to
 * correct the address, because erasing it would destroy a school's application with nobody told. That hold ends with the
 * season: once the season applied for is `past`, every application still awaiting a decision is erased here, whatever its
 * seats answered and whether or not its notice could be delivered, because no decision can be taken for a season that is
 * over. That clock runs before the two above it, so an application it takes is neither chased nor listed for a notice. The
 * declined, accepted and contact-block clocks erase and redact in this call. Every removal names this season alone.
 *
 * One call reminds, lists and clears contact blocks for a bounded share of what is due, the first two earliest deadline
 * first; the rest stay due and the calls after it take them. The reminders are committed by the call's LAST transactions, so no later step
 * of the same call can answer an error in their place; where the request's deadline cuts them after one has committed, the call
 * answers what committed and warns once.
 *
 * An application or a season row whose write fails, the database refusing it or anything else, or one the answer cannot carry,
 * is passed over alone and logged by id: the rest of its clock's page or share goes, and it stays due, so the next pass meets it
 * again and one failing record holds back no clock and nobody behind it. `fehlgeschlagen` sums the rows each of the six clocks
 * passed over: a day stamped beside a sum that is not zero is a clock passing rows over, not one that ran clean.
 *
 * 404 where no season has the id. Idempotent per day once every share has been taken: a run after that writes nothing,
 * though it logs the count of withheld seats again.
 *
 * The accepted clock and the contact block run once a later season has ended while this one is not `active`, the moment the
 * season-after rule stops keeping this season's pupils: a running season keeps both, and a later season planned and never run
 * holds neither back. A season whose id is not a four-digit year fails the whole pass rather than running the four clocks
 * that need no later season, because a pass that skipped those two quietly would leave both stopped for ever with nothing
 * anywhere saying so. From that moment every pass also strips, on the rows and in their log images, the season's fixture
 * confirmation rows of every seat's link entry, each reason and a contact's holder digest, and its match
 * reports of their remarks and every card's reason; the answers' way, day and role and the reports' scorers, cards and
 * result stay as the record. Each strip is its own transaction after the blocks' share: one that fails is
 * logged under the season's id and counted in `fehlgeschlagen`, and the blocks clear all the same.
 *
 * One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
 * answers it. So a day's first call records the day and the rest of that day's calls record nothing.
 * @summary Run one season's retention clocks
 */
export const BewerbungenSweepSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Record that the deletion notice reached the applications named, so an erasure that fails afterwards mails nobody twice.
 *
 * An id whose stamp fails, the database refusing it or anything else, is passed over alone, logged by id, left unstamped and
 * counted in `fehlgeschlagen`. Every later pass then lists it as unannounced, so a caller mailing those mails its notice again,
 * and `/loeschen` skips it: until a stamp lands it stands until its season is `past`.
 *
 * The ids are re-judged in-session: only one still submitted, past its deadline and with a seat outstanding is stamped, and one
 * already carrying a stamp keeps the day it has. An id whose Ansprechperson the mail provider refused between the pass and this
 * call is skipped, so a notice the provider never carried is not recorded as delivered. 404 where no season has the id. An empty
 * list answers zero.
 * @summary Stamp the candidates whose notice was delivered
 */
export const BewerbungenAngekuendigtBewerbungenParams = zod.object({
  saison_id: zod.string(),
});

export const bewerbungenAngekuendigtBewerbungenBodyBewerbungIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const bewerbungenAngekuendigtBewerbungenBodyBewerbungIdsMax = 83;

export const BewerbungenAngekuendigtBewerbungenBody = zod
  .object({
    bewerbung_ids: zod
      .array(zod.string().regex(bewerbungenAngekuendigtBewerbungenBodyBewerbungIdsItemRegExp))
      .max(bewerbungenAngekuendigtBewerbungenBodyBewerbungIdsMax),
  })
  .describe("Which candidates' notices the caller delivered. The backend re-judges them: an id that has stopped qualifying is skipped.");

/**
 * Erase the applications whose deletion notice went out, and redact every log row naming them.
 *
 * The ids are re-judged in-session: only one still submitted, past its deadline, with a seat outstanding, whose announcement the
 * mail provider will still carry AND carrying the announcement stamp is erased, so an application confirmed and accepted between
 * the calls survives, one whose notice bounced after it was stamped is held rather than destroyed, and an id from another
 * season or one nobody was told about is skipped rather than refused. 404 where no season has the id. An empty list answers zeros.
 *
 * An id whose erasure fails, the database refusing it or anything else, is passed over alone, logged by id, left standing and
 * counted in `fehlgeschlagen`.
 * @summary Erase the notified deletion candidates
 */
export const BewerbungenLoeschenBewerbungenParams = zod.object({
  saison_id: zod.string(),
});

export const bewerbungenLoeschenBewerbungenBodyBewerbungIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const bewerbungenLoeschenBewerbungenBodyBewerbungIdsMax = 83;

export const BewerbungenLoeschenBewerbungenBody = zod
  .object({
    bewerbung_ids: zod
      .array(zod.string().regex(bewerbungenLoeschenBewerbungenBodyBewerbungIdsItemRegExp))
      .max(bewerbungenLoeschenBewerbungenBodyBewerbungIdsMax),
  })
  .describe(
    "Which candidates to erase. The backend re-selects them: an id that has stopped qualifying, or that was never announced, is skipped.",
  );

/**
 * Answer which kit colours this season has assigned, so the form can offer the rest.
 *
 * 404 unless that season takes applications today, which is the one state the form reads this in.
 * The SET alone, naming no club (`READ-BEWERBUNG-001`).
 * @summary The kit colours a Saison has already assigned
 */
export const BewerbungenGetTrikotfarbenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Record what the mail provider reported about one message, on every seat that message was sent to.
 *
 * Applied only where the event names the message the seat still holds AND is stamped strictly later than the state
 * it holds: a re-send mints a new message, so the old one's bounce must not mark the fresh link, and a redelivery or
 * an event overtaken by a later one changes nothing. Both are answered with the seats written -- none, where nothing
 * qualified -- rather than with a refusal, because the provider retries anything but a success and would resend a
 * settled event for hours.
 *
 * 404 where no application has the id, which an application erased between the send and the event is: a caller that
 * must not retry maps it rather than repeating the call.
 * @summary Apply one delivery event to the seats its message was sent to
 */
export const bewerbungenPostZustellungBodyAmMax = 64;

export const bewerbungenPostZustellungBodyBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const bewerbungenPostZustellungBodyGrundOneMax = 128;

export const bewerbungenPostZustellungBodyGrundOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const bewerbungenPostZustellungBodyNachrichtIdMax = 128;

export const BewerbungenPostZustellungBody = zod
  .object({
    am: zod.string().min(1).max(bewerbungenPostZustellungBodyAmMax),
    bewerbung_id: zod.string().regex(bewerbungenPostZustellungBodyBewerbungIdRegExp),
    grund: zod.union([
      zod.string().max(bewerbungenPostZustellungBodyGrundOneMax).regex(bewerbungenPostZustellungBodyGrundOneRegExp),
      zod.null(),
    ]),
    nachricht_id: zod.string().min(1).max(bewerbungenPostZustellungBodyNachrichtIdMax),
    rollen: zod.array(zod.enum(["trainer", "ansprechperson", "stellvertretung"])),
    stand: zod.enum(["zugestellt", "verzoegert", "unzustellbar", "unterdrueckt", "beschwerde"]),
  })
  .describe("One delivery event about a message this application's seats were sent.");

/**
 * Record that the mail provider accepted one message for the seats named, under the id it answered with.
 *
 * That id is the only join between a send and any later delivery event, so a seat carrying none is a seat every event
 * about it is discarded for. Accepting a request is not delivering it: what this records is that the provider took the
 * message, and `POST /bewerbungen/zustellung` is where the recipient's own mail server is heard from.
 *
 * Applied per seat and only where this send is newer than the ACCEPT the seat already holds, so a call retried after
 * a later one landed writes nothing; a delivery state the provider stamped never blocks it, that stamp being the
 * provider's clock rather than this sender's. A seat the application does not hold -- erased, or never mailed -- is
 * skipped rather than refused, and the answer names the seats that were written. 404 where no application has the id.
 * @summary Record the message the provider accepted for these seats
 */
export const bewerbungenAngenommenZustellungBodyAmMax = 64;

export const bewerbungenAngenommenZustellungBodyBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const bewerbungenAngenommenZustellungBodyNachrichtIdMax = 128;

export const BewerbungenAngenommenZustellungBody = zod
  .object({
    am: zod.string().min(1).max(bewerbungenAngenommenZustellungBodyAmMax),
    bewerbung_id: zod.string().regex(bewerbungenAngenommenZustellungBodyBewerbungIdRegExp),
    nachricht_id: zod.string().min(1).max(bewerbungenAngenommenZustellungBodyNachrichtIdMax),
    rollen: zod.array(zod.enum(["trainer", "ansprechperson", "stellvertretung"])),
  })
  .describe("One message the provider accepted. `stand` is not a key: this endpoint records `angenommen` and no other state.");

/**
 * One application in full, which is what the triage decides against; its decision's administrator is withheld as the list withholds it.
 *
 * Answers whether its confirmation deadline has passed today, so the editor words the deletion without reading a day of its own.
 * @summary One Bewerbung
 */
export const bewerbungenGetBewerbungByIdPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenGetBewerbungByIdParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenGetBewerbungByIdPathBewerbungIdRegExp),
});

/**
 * Decline an application, recording who decided and the reason they gave.
 *
 * The submission itself is untouched: a decline moves `status` and `entscheidung` and nothing else,
 * so what the school wrote stays the record the decision was taken against.
 * @summary Decline a Bewerbung
 */
export const bewerbungenAblehnenBewerbungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenAblehnenBewerbungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenAblehnenBewerbungPathBewerbungIdRegExp),
});

export const bewerbungenAblehnenBewerbungBodyGrundMax = 1000;

export const BewerbungenAblehnenBewerbungBody = zod
  .object({
    grund: zod.string().min(1).max(bewerbungenAblehnenBewerbungBodyGrundMax),
  })
  .describe(
    "Why the application was declined.\n\nIts own declaration and never shared with the acceptance's: the two are not inverses, and a\npayload reaching both would let a value typed for one arrive at the other.",
  );

/**
 * Accept an application, creating the school's club where the applicant proposed a new one.
 *
 * IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
 * confirm their own seat (`REQ-BEWERBUNG-013`), so every seat enters the season as its person confirmed it.
 * @summary Accept a Bewerbung and enter the school into the season
 */
export const bewerbungenAnnehmenBewerbungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenAnnehmenBewerbungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenAnnehmenBewerbungPathBewerbungIdRegExp),
});

export const BewerbungenAnnehmenBewerbungBody = zod
  .object({
    gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
    trikot_farbe: zod.union([
      zod.enum([
        "schwarz",
        "weiss",
        "grau",
        "braun",
        "bordeaux",
        "rot",
        "koralle",
        "orange",
        "gold",
        "gelb",
        "limette",
        "hellgruen",
        "gruen",
        "smaragd",
        "tuerkis",
        "cyan",
        "hellblau",
        "meerblau",
        "blau",
        "dunkelblau",
        "flieder",
        "violett",
        "magenta",
        "rosa",
      ]),
      zod.null(),
    ]),
  })
  .describe(
    "Which group the school enters, and the kit colour the league assigns it.\n\nNo `saison_id`: the application names its own season, so a payload carrying one could only\ndisagree with it.",
  );

/**
 * Mint a fresh link for one seat and answer it raw, for the caller to mail; the old link then opens nothing.
 *
 * Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
 * The answer names the address and the seats as the write found them, so a correction landing mid-request is where the link goes.
 * The application's confirmation deadline restarts from today and the seat's reminder is owed again. The mirrored seat
 * is judged with the pressed one, a seat an erasure emptied is refused as an answered one is, and a
 * decision, an answer or an erasure landing while the request runs is refused too. A seat whose address the ban list
 * holds is refused `REQ-BEWERBUNG-019`. A path naming no seat is a 404.
 * @summary Re-send one seat's confirmation link
 */
export const bewerbungenErneutEinwilligungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenErneutEinwilligungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenErneutEinwilligungPathBewerbungIdRegExp),
  seat: zod.string(),
});

/**
 * Write another person into a seat its own holder stepped out of, and mint the fresh link to mail them.
 *
 * It runs on an EMPTY seat alone, and the one thing that empties a seat this way is that person's own Widerspruch.
 * The record written is administrative and confirms nothing: the new person's own link is what asks them, and an
 * acceptance waits on that answer as it waits on the other two. Where one person holds two seats both are filled
 * from one press and one link answers both, and both must be empty for either to be written.
 *
 * The link the seat's last holder was sent stops opening anything, and the application's confirmation deadline
 * restarts from today EVEN WHERE IT HAD PASSED: left where it was, it would hand the new person a link that opens
 * nothing, seating them for a confirmation they cannot give.
 *
 * Refused on an application already decided (`REQ-BEWERBUNG-001`); on any seat this write would reach that nobody
 * stepped out of — confirmed, still waiting or erased at its person's request, the claimed mirror included
 * (`REQ-BEWERBUNG-011`); and on an address another
 * contact person on this application already holds (`REQ-BEWERBUNG-014`), or that the ban list holds
 * (`REQ-BEWERBUNG-019`); and on any label but the application form's running one (`REQ-EINWILLIGUNG-001`), the person
 * seated being a new acceptance. A path naming no seat is a 404.
 * @summary Seat another person where a contact person stepped out
 */
export const bewerbungenBesetzeKontaktSitzPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenBesetzeKontaktSitzParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenBesetzeKontaktSitzPathBewerbungIdRegExp),
  seat: zod.string(),
});

export const bewerbungenBesetzeKontaktSitzBodyEmailMax = 254;

export const bewerbungenBesetzeKontaktSitzBodyNachnameMax = 80;

export const bewerbungenBesetzeKontaktSitzBodyNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenBesetzeKontaktSitzBodyTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenBesetzeKontaktSitzBodyTextVersionMax = 64;

export const bewerbungenBesetzeKontaktSitzBodyVornameMax = 80;

export const bewerbungenBesetzeKontaktSitzBodyVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");

export const BewerbungenBesetzeKontaktSitzBody = zod
  .object({
    email: zod.string().max(bewerbungenBesetzeKontaktSitzBodyEmailMax),
    nachname: zod.string().min(1).max(bewerbungenBesetzeKontaktSitzBodyNachnameMax).regex(bewerbungenBesetzeKontaktSitzBodyNachnameRegExp),
    telefon: zod.string().regex(bewerbungenBesetzeKontaktSitzBodyTelefonRegExp),
    text_version: zod.string().min(1).max(bewerbungenBesetzeKontaktSitzBodyTextVersionMax),
    vorname: zod.string().min(1).max(bewerbungenBesetzeKontaktSitzBodyVornameMax).regex(bewerbungenBesetzeKontaktSitzBodyVornameRegExp),
  })
  .describe(
    "The person seated where a contact person stepped out, carrying no `einwilligung` block.\n\n`FLBewerbungKontaktpersonPayload`'s is `erteilt: Literal[True]`, and this person has agreed to\nnothing: their own link is what asks them.",
  );

/**
 * Write a corrected address onto one seat and mint the fresh link to mail there; the old link then opens nothing.
 *
 * **The mailbox the link leaves is answered in `abgang_email`** for the caller to tell, as the contacts editor's save
 * answers one it takes off a seat; null where the corrected address is the one the seat held.
 *
 * The only repair there is for a link the mail provider will not carry: everything else the school typed stays the
 * record the decision is taken against. Where one person holds two seats both are corrected, and the confirmation
 * deadline restarts from today exactly as a re-send restarts it.
 *
 * The seat's delivery state goes with the entry it sat in, so an application held back from the fourteen-day
 * deletion because its notice could not arrive is a deletion candidate again once the corrected link is answered
 * for or its deadline passes. Refused on an application already decided (`REQ-BEWERBUNG-001`), on any seat this
 * write would reach that is already confirmed, already answered with a Widerspruch, or holding nothing to confirm
 * — the mirrored seat included (`REQ-BEWERBUNG-011`) — on a seat holding another address than `bisherige_email`, the address the
 * caller's page showed, as after a Widerspruch and a reseat (`REQ-BEWERBUNG-021`), and on an address another contact person on this
 * application already holds (`REQ-BEWERBUNG-014`), or that the ban list holds (`REQ-BEWERBUNG-019`). A path naming
 * no seat is a 404.
 * @summary Correct one contact person's email address and re-send their link
 */
export const bewerbungenKorrigiereKontaktEmailPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenKorrigiereKontaktEmailParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenKorrigiereKontaktEmailPathBewerbungIdRegExp),
  seat: zod.string(),
});

export const bewerbungenKorrigiereKontaktEmailBodyBisherigeEmailMax = 254;

export const bewerbungenKorrigiereKontaktEmailBodyEmailMax = 254;

export const BewerbungenKorrigiereKontaktEmailBody = zod
  .object({
    bisherige_email: zod.string().max(bewerbungenKorrigiereKontaktEmailBodyBisherigeEmailMax),
    email: zod.string().max(bewerbungenKorrigiereKontaktEmailBodyEmailMax),
  })
  .describe("The corrected address, and NOTHING else of the person: a bounced link is repaired, not the submission rewritten.");

/**
 * Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.
 *
 * WITHDRAW-ONLY: the season seat's payload, a grant of either choice being the confirmation page's alone; the
 * account page offers it so taking a consent back is as easy as giving it was (Art. 7(3) DSGVO). One answer for
 * every seat the person holds there, each choice moving only where it differs from the application as the page
 * served it; no other seat, field or document is written, and a press moving no seat writes nothing. Nothing is
 * counted against the person's ceiling.
 *
 * Refuses, in this order: an application that is decided or holds no confirmed seat of the address
 * (`REQ-FUNKTION-001`); a `nachweis_stand` other than the held seats' own, either choice having moved since the
 * page was served (`REQ-EINWILLIGUNG-003`); a grant of either choice (`REQ-EINWILLIGUNG-004`); and a `text_version`
 * naming no version of the account page's seat control (`REQ-EINWILLIGUNG-001`). Each refusal writes nothing.
 * @summary Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung
 */
export const bewerbungenPatchEinwilligungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenPatchEinwilligungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenPatchEinwilligungPathBewerbungIdRegExp),
});

export const bewerbungenPatchEinwilligungBodyTextVersionMax = 64;

export const BewerbungenPatchEinwilligungBody = zod
  .object({
    medien: zod.boolean(),
    nachweis_stand: zod.object({
      medien: zod.union([zod.string(), zod.null()]),
      umfang: zod.union([zod.string(), zod.null()]),
    }),
    text_version: zod.string().min(1).max(bewerbungenPatchEinwilligungBodyTextVersionMax),
    umfang: zod.enum(["kontaktdaten", "kontaktdaten_whatsapp"]),
  })
  .describe(
    "The season seat's payload on a pending application, where its press takes withdrawals alone.\n\nThe same shape, so one control serves both; a grant on it is refused rather than unrepresentable.",
  );

/**
 * Return the words a consent label names: its paragraphs, its switch, its other controls, its page and the day it took effect.
 *
 * A label's words never change, so the answer may be cached. A label the registry does not hold 404s,
 * and never answers another label's words.
 * @summary The words one consent label names
 */
export const EinwilligungGetFassungParams = zod.object({
  text_version: zod.string(),
});

/**
 * File one log row saying that this administrator ended every session of an address, and when, before the caller ends them.
 *
 * ADMIN TIER, a step-up write. The sessions live in the sign-in store, which the caller holds and this backend does not, so
 * the row is the whole of what this writes: collection `anmeldungen`, operation `delete_many`, the administrator as actor,
 * and no address, filter, image or count. Nothing bars the address and nothing is mailed; a person signs in again as before.
 *
 * Refused so that a refused call ends no session: from a sign-in older than the step-up window (`REQ-AUTH-009`), the
 * administrator's own address (`REQ-PURGE-003`), an address holding an `owner` grant unless the administrator holds an
 * owner's power (`REQ-PURGE-005`). Unlike the erasure, it
 * ends another administrator's sessions for an administrator holding no owner's power: signing in again repairs it.
 * @summary Log the ending of every session an address holds
 */
export const identitaetPostAbmeldungBodyEmailMax = 254;

export const identitaetPostAbmeldungBodyEmailRegExp = new RegExp("@");

export const IdentitaetPostAbmeldungBody = zod
  .object({
    email: zod.string().max(identitaetPostAbmeldungBodyEmailMax).regex(identitaetPostAbmeldungBodyEmailRegExp),
  })
  .describe("The mailbox whose every session the page ends next, looked up as the erasure looks one up.");

/**
 * Answer what the sign-in gate decides on for one mailbox: its own records, its pending confirmation, its ban and its grant.
 *
 * No record, name or id is answered, only flags and the grant's tier. Stores nothing, and a POST for `POST /identitaet/subjekt`'s
 * reason. The address is folded on arrival and compared as that endpoint compares it, and `unbestaetigt`, `gesperrt` and
 * `verwaltung` are that endpoint's own answers.
 *
 * `konto` is true exactly where the mailbox holds a record its own person confirmed: a contact seat on any season row, a past
 * season's and a withdrawn team's included; a contact seat on a pending application; a pupil or referee record, a retired one
 * included, never the placeholder every erased referee's fixtures name; and a pending registration whose pupil confirmed it with
 * a choice. A decided application, a declined registration and every unconfirmed record count for nothing. It holds wherever
 * `POST /identitaet/subjekt` answers a record, and also where the only records are ones granting no panel.
 *
 * The ban narrows neither flag: a barred address holding records is answered `gesperrt` and `konto` both, and refusing it is the
 * caller's. A mailbox the league holds nothing for is answered both flags false rather than a 404.
 * @summary Say whether one mailbox may be offered a sign-in
 */
export const identitaetGetAnmeldungBodyEmailMax = 254;

export const IdentitaetGetAnmeldungBody = zod
  .object({
    email: zod.string().max(identitaetGetAnmeldungBodyEmailMax),
  })
  .describe("Which mailbox is asking, folded to the one spelling the join, the header and the log agree on.");

/**
 * Erase every record an address holds, on a request that person made by mail, at once and as one write, and answer how many of each kind went.
 *
 * ADMIN TIER, a step-up write. It runs the erasure `POST /identitaet/selbst/erasure` runs and refuses nothing about the
 * person's own state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass.
 * Three refusals are about who asks. The administrator's own address is refused (`REQ-PURGE-003`): their account page
 * serves it, or an owner. An address holding a live grant is refused unless the administrator holds an owner's power,
 * signed in since becoming one (`REQ-PURGE-005`), judged inside the write: erasing it removes the grant, whatever grants
 * remain, so it asks what a revoke asks, an owner's power and a sign-in `ENROLMENT_WINDOW_MINUTES` old at most. Every
 * other address is erased from a sign-in inside the step-up window. Either window missed answers `REQ-AUTH-009`. An
 * address another address's pending change would move to is refused, judged inside the write, where that address holds a
 * live grant and the administrator no owner's power (`REQ-PURGE-007`): the erasure ends the change, a discard only an
 * owner makes of it. The refusal tells that administrator some change the preview withholds names the address.
 *
 * `anlass` names the request the erasure answers, and every log row the erasure files carries it; no other row does. No
 * redaction reaches it, so it is refused 422 where it holds an address, and, inside the write ahead of the erasure's first
 * step, where it holds a name of the person's own records as a whole word or before a genitive s (`REQ-PURGE-006`): each
 * name field whole and each of its words, but a particle such as `von` before a later word of its field and any single
 * letter. Names compare as stored, spacing aside, and equal where their plain lower or their plain upper case is: „Weiss“
 * is refused for „Weiß“, whose capitals it shares, and another spelling such as „Mueller“ for „Müller“ passes. A common
 * word equal to a name is refused with it. The grant notice names this administrator as ending the
 * person's grant. An address holding nothing is answered with every count zero. The 404 and the 409 answer only a database
 * changed by hand under the request. The sign-in account is not touched here: deleting it is the caller's, once this has
 * answered.
 * @summary Erase every record an address holds, on that person's request
 */
export const identitaetEraseAufAnfrageBodyAnlassMax = 200;

export const identitaetEraseAufAnfrageBodyAnlassRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const identitaetEraseAufAnfrageBodyEmailMax = 254;

export const identitaetEraseAufAnfrageBodyEmailRegExp = new RegExp("@");

export const IdentitaetEraseAufAnfrageBody = zod
  .object({
    anlass: zod.string().min(1).max(identitaetEraseAufAnfrageBodyAnlassMax).regex(identitaetEraseAufAnfrageBodyAnlassRegExp),
    email: zod.string().max(identitaetEraseAufAnfrageBodyEmailMax).regex(identitaetEraseAufAnfrageBodyEmailRegExp),
  })
  .describe("The mailbox, and the request the erasure answers, which every log row the erasure files keeps.");

/**
 * Answer which of this address's records `POST /identitaet/erasure` would remove or empty, by kind, name and the ids a page links each by.
 *
 * ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot, so it names
 * every one of them, an unconfirmed seat, a retired row, a pupil's every squad row and a declined registration among them,
 * and no other. Another address's pending change to this address is named by its id, the change going and that address's
 * records standing, beside why the address tool refuses that change this administrator, or null where it opens it; a change
 * of an address holding a grant is left out for an administrator without an owner's power, as the administrators page
 * withholds it, since naming it would answer whether a typed address is its new one. The address's own live change is
 * named by its id, ending with the records it would move. Every request for a grant about the address (`betroffen`) or
 * made by it (`gestellt`) is named by its id and the tier it asks; a lapsed one is gone to every reader already and is
 * left out, though the erasure removes its row too. A squad
 * row and a referee row each carry the day it was retired, null while live, and a referee row every season holding a
 * fixture still to be played that it is booked on, as `REQ-RETIRE-004` judges one. Reached and not named: the fixtures
 * booking a referee row, which move onto the ghost, and the referee's name in each of those fixtures' log images, which
 * goes; the match reports a referee row sent, which stand naming the ghost, in
 * their log images too; the confirmations a referee row was asked for, which go, and its id
 * and reason in a removed season's log images; the links its contact seats were mailed on their teams' open match
 * confirmations, which stop answering; every reason typed from the address answering a match confirmation, from any seat,
 * which goes from its row and its log images, the answer standing; the grants, bans, invitations and decisions the address made for
 * others, which name a marker in its place; its day counts; its rows in the log; every log image of a record the
 * erasure removes, emptied whole whether or not it holds the address, and every other log image holding the address;
 * a dead spelling of its grant, which admits nobody, each grant's announced row, and an announced row holding the
 * address under another grant's id; and the address in every notice still queued, withheld. Written besides: the
 * notice that the address's grant ended, which every administrator is sent. No address and no birthdate is answered.
 * `verwaltung` is the tier of the live grant the address holds, or null. `gesperrt` is whether a standing ban holds the
 * address, judged as `POST /identitaet/gesperrt` judges one; the erasure leaves a ban standing. Stores nothing.
 *
 * Refused as the erasure is: the administrator's own address (`REQ-PURGE-003`), an address holding a live grant unless
 * the administrator holds an owner's power (`REQ-PURGE-005`).
 * @summary Show what an erasure of an address would remove
 */
export const identitaetGetErasureAnsichtAufAnfrageBodyEmailMax = 254;

export const identitaetGetErasureAnsichtAufAnfrageBodyEmailRegExp = new RegExp("@");

export const IdentitaetGetErasureAnsichtAufAnfrageBody = zod
  .object({
    email: zod.string().max(identitaetGetErasureAnsichtAufAnfrageBodyEmailMax).regex(identitaetGetErasureAnsichtAufAnfrageBodyEmailRegExp),
  })
  .describe("The mailbox the reveal is read for, in the BODY for `FLSubjektPayload`'s reason.");

/**
 * Answer whether a standing ban holds the one address the frontend's mailer is about to send to.
 *
 * Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the address travels in the body, so no path or query carries it
 * into an access line.
 *
 * The address is judged as a stored one is: every spelling that folds to the same mailbox -- its letters in any case, its domain in
 * Unicode or in punycode -- answers alike, and a ban holds only while the running season is within its bound, every ban holding
 * while no season runs. An address today's address rule refuses is answered `false` rather than refused, no ban being keyable
 * under it: the mailer sends to the addresses records hold, some of them stored under older rules.
 *
 * The flag is the whole answer. No record the address holds and no part of the ban reaches the caller, which needs neither.
 * @summary Say whether a ban stands on an address about to be mailed
 */
export const identitaetGetGesperrtBodyEmailMax = 254;

export const identitaetGetGesperrtBodyEmailRegExp = new RegExp("@");

export const IdentitaetGetGesperrtBody = zod
  .object({
    email: zod.string().max(identitaetGetGesperrtBodyEmailMax).regex(identitaetGetGesperrtBodyEmailRegExp),
  })
  .describe("The one address a message is about to go to.");

/**
 * Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.
 *
 * The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
 * in the latest `past` season, in any season with a greater id or in the running one, and no registration still `eingereicht`
 * at their address, compared as the sign-in folds it. While no season is `past` nobody is due, and `abgeschlossene_saison_id`
 * is null. A pupil holding no address is never due: nothing else erases by a name. A pupil whose stored address no request
 * matches, empty, unfolded or refused by the address rule, is passed over and named by id in a warning: a hand correction
 * left it so, and an erasure by another spelling would remove nobody.
 *
 * Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
 * pending registration since this call read them, the two committing before that transaction writes included, or whom another
 * call deleted first, is counted `uebersprungen` and left standing. A squad entry or a registration meeting that transaction's
 * writes waits for it to end: the entry then finds nobody, and the registration is stored for a pupil already gone.
 * Two calls at once therefore delete each pupil once. Deleted are
 * the pupil's own data alone: the pupil record, every squad row it holds and every registration at the address, a declined
 * one included, each with its log images, and their day counts as a pupil; every log row they wrote as a pupil keeps a
 * fixed marker in their place. A contact seat, a referee record, a grant and anything else held at the same
 * address stand, and so do the log images naming them.
 *
 * **A pass is a run of calls, each handing the next the `nach` the last answered**, the first naming none; it ends at the call
 * answering `nach` null. A call reaches at most a fixed share of the due pupils after `nach`, in `_id` order, and the pass
 * holds no state on the server. A pupil whose deletion fails, the database refusing it or anything else, is counted
 * `fehlgeschlagen`, logged by id and passed, so a failing record holds back nobody behind it in the pass; it stays due, and
 * the next pass tries it again. Where the request's deadline cuts the call, it stops at that pupil, warns once, and answers
 * what it did; the rest stay due, and the pass goes on from the next call. `verbleibend` counts the pupils due after the
 * call, those it failed or passed over among them, so it is no stopping condition. No body: the call takes no season and no
 * limit.
 *
 * The 409 is published because the duplicate-key trace reaches the registry's insert of the pupils' sentinel and reads no
 * handler; this call counts that failure as any other and never answers it.
 * @summary Delete one share of the pupils the season-after rule makes due
 */
export const identitaetPostLoeschungLaufQueryNachOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const IdentitaetPostLoeschungLaufQueryParams = zod.object({
  nach: zod.union([zod.string().regex(identitaetPostLoeschungLaufQueryNachOneRegExp), zod.null()]).optional(),
});

/**
 * Answer which of the addresses asked about no league record references, so the sign-in account each names may be deleted.
 *
 * Stores nothing, and a POST for `POST /identitaet/subjekt`'s reason: the addresses travel in the body.
 *
 * An address is referenced, and so never answered, while any of these holds:
 *
 * - a contact seat on any season row holds it, a `past` season's and a withdrawn team's included, confirmed or not;
 * - a contact seat on a pending application holds it, confirmed or not;
 * - a pupil or referee record holds it, confirmed or not and live or retired; the placeholder every erased referee's fixtures
 *   name and the one every erased pupil's entries name hold nothing;
 * - a pending registration holds it that its pupil confirmed;
 * - a grant in `berechtigungen` holds it, as stored, before the comparison has seen it too;
 * - an address change that took effect replaced it, and the notice owing its sign-in account's carry to the new address is
 *   not yet delivered.
 *
 * A ban holds nothing: a barred address is answered as any other once none of these holds it. A pending address change holds
 * nothing either: its new address admits no sign-in until the change takes effect, and the address it replaces stays on the
 * records until then.
 *
 * That is wider than what `POST /identitaet/anmeldung` admits a sign-in on, so no account answered here is one the sign-in
 * would admit again: an unconfirmed seat on a `past` season and an unconfirmed retired record keep an account the gate admits
 * no sign-in for, until the block is cleared or the row removed.
 *
 * The whole batch is refused, `REQ-REFERENZEN-001`, while no live grant in `berechtigungen` is an `owner`'s. A league always
 * holds one, so such a database is empty or another one, and answering from it would call every address unreferenced.
 *
 * Each address is compared as `POST /identitaet/subjekt` compares one, on the sign-in fold, and answered in the spelling it was
 * asked in, once however often it was asked. An address today's address rule refuses is judged as any other and never
 * refused, since one refused address would refuse the whole batch. A batch past its published ceiling is refused whole.
 * @summary Say which of these sign-in addresses no record references
 */
export const identitaetGetReferenzenBodyIdentifiersMax = 250;

export const IdentitaetGetReferenzenBody = zod
  .object({
    identifiers: zod.array(zod.string()).min(1).max(identitaetGetReferenzenBodyIdentifiersMax),
  })
  .describe("The sign-in addresses a pass of the account sweep asks about.");

/**
 * Answer which confirmed contact seats, pupil records and referee records the league holds for one mailbox.
 *
 * Stores nothing, and a POST all the same: the identifier travels in the body so that no path or query carries an address into an
 * access line, which is `POST /identitaet/erasure/ansicht`'s reason too.
 *
 * The address is folded to the sign-in identifier -- trimmed, its domain in punycode, its ASCII letters lower-cased -- on arrival
 * and matched by equality, every record storing its address in that form: `Anna.Mueller@Schule.de` asked answers for the
 * `anna.mueller@schule.de` a contact seat stores, and a domain asked as `müller.de` for the `xn--mller-kva.de` a record stores. `ß`
 * is not folded to `ss`, so `poststrasse.de` and `poststraße.de` are two domains here as they are at sign-in.
 *
 * A record is answered only once its own person has confirmed it -- a seat's `einwilligung.bestaetigt_am`, judged per seat, and the
 * same stamp on a pupil's and a referee's consent record, an empty stamp confirming nothing -- and only while its row is live: a
 * retired pupil or referee is answered nothing, and so is the placeholder every erased referee's fixtures name. A seat on a season
 * its team withdrew from, by disqualification or withdrawal alike, is answered nothing either; its seats on other seasons stand.
 * A seat on a `past` season is still answered, carrying its `saison_status`: which seasons grant a panel is each caller's to decide.
 *
 * `unbestaetigt` is true exactly where the mailbox holds records that could grant a panel -- a live pupil or referee row, or a seat
 * on an `active` or `future` season -- and none of them is confirmed, so an unconfirmed person is told apart from one the league
 * holds nothing for. A seat on a `past` season counts toward neither answer: confirming it would open nothing.
 *
 * `gesperrt` says whether the address is on the ban list, judged as a sign-up is: the address in any spelling that folds to the same
 * mailbox, and a ban only while the running season is within its bound. It narrows none of the records beside it.
 *
 * `verwaltung` is the grant the mailbox holds in `berechtigungen` -- `owner`, `administration`, or null for none -- matched on the
 * folded identifier alone, the one spelling a grant is stored in. It is the one stored answer here: whether a person is an
 * administrator is decided by a grant rather than derived from a league record, and it narrows none of the records beside it. A
 * promotion to `owner` made in the database is answered `administration` until `POST /berechtigungen/abgleich` finds it.
 *
 * `berechtigt_seit` is when that grant took effect, null exactly where `verwaltung` is: the moment `POST /berechtigungen/abgleich`
 * first found a grant made in the database directly, the grant's own `erteilt_am` for one made through the application, and for one
 * made in the database that no call to that endpoint has read yet, its `erteilt_am` or the moment its id was generated, whichever is
 * later. A row changed in the database after that endpoint read it -- an address changed in place, a spelling no request matched
 * made one that does, a row put back after its removal was found -- is no grant, `verwaltung` null, until that endpoint finds the
 * change. A tier change leaves it standing. An admin-tier request from a sign-in older than it is refused.
 *
 * `inhaber_seit` is when the `owner` tier took effect, null exactly where `verwaltung` is not `owner`: the moment the tier change
 * made the grant an owner's, or that endpoint found a promotion made in the database, and never earlier than `berechtigt_seit`. A
 * sign-in older than it administers and holds no owner's power, so the revoke and the tier change it asks for are refused. A
 * demotion takes the tier at once.
 *
 * Each list may be empty and each may hold more than one entry: one person holds seats at two clubs, and nothing enforces one pupil
 * record per address.
 * An address the league holds nothing for is answered with three empty lists and `unbestaetigt` false rather than a 404.
 * @summary Say which league records one mailbox holds
 */
export const identitaetGetSubjektBodyEmailMax = 254;

export const IdentitaetGetSubjektBody = zod
  .object({
    email: zod.string().max(identitaetGetSubjektBodyEmailMax),
  })
  .describe("Which mailbox is asking, folded to the one spelling the join, the header and the log agree on.");

/**
 * Start a change of the address the person signs in on, answering both raw links once, for the frontend's server to mail.
 *
 * The new mailbox is mailed its link, and the address on file a notice with a stop link; **everything the address holds
 * as its person's own moves when the new mailbox confirms**, within `ADRESSWECHSEL_GUELTIG_STUNDEN`. Where it holds a
 * grant, the change also waits on another administrator's approval, an owner's for an owner's grant,
 * `genehmiger_anzahl` counts who could give it, and the grants' outbox tells them (`POST /berechtigungen/abgleich`). The address's live
 * change ends replaced, an administrator's too: a sign-in at the address on file proves the mailbox is not lost.
 * **Nothing about the new address is judged here** -- the ban list, another pupil, a grant it holds -- so this start
 * answers alike whatever the new address holds.
 *
 * Refused `REQ-AUTH-009` from a sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES`, or by code where the
 * address holds a grant;
 * `REQ-ADRESSWECHSEL-010` where the address holds nothing a change moves; `-007` where the typed address is the one
 * signed in; `-011` where nobody could approve the grant's move, the last owner making another first; and
 * `REQ-DROSSELUNG-001` past the day's count of starts and approvals.
 * @summary Start a change of the signed-in person's address
 */
export const kontoPostAdresswechselBodyEmailMax = 254;

export const KontoPostAdresswechselBody = zod.object({
  email: zod.string().max(kontoPostAdresswechselBodyEmailMax),
});

/**
 * Approve the change `id` names, which an administrator started without a reason, minting the new mailbox's link once.
 *
 * **Nothing reaches the new mailbox before this press**. Nothing about the new address is
 * judged here either: the approver is owed no answer about it, and the confirmation judges it. **The press approves the
 * change its page showed alone**: an administrator's later start replaces that one, and its id then names an ended change.
 *
 * Refused `REQ-AUTH-009` as the start is; `REQ-ADRESSWECHSEL-002` where the change `id` names has ended; 404 where it
 * is no change of this address awaiting its approval; `REQ-ADRESSWECHSEL-003` past the approval's deadline; and
 * `REQ-DROSSELUNG-001` as the start is.
 * @summary Approve the address change an administrator asked of the signed-in person
 */
export const kontoPostAdresswechselFreigabeBodyIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const KontoPostAdresswechselFreigabeBody = zod
  .object({
    id: zod.string().regex(kontoPostAdresswechselFreigabeBodyIdRegExp),
  })
  .describe("The change the page showed: an administrator's later start replaces it, and the approval then reaches nothing.");

/**
 * Every pending registration, newest first, narrowable by season, by team and by status.
 *
 * `bestaetigt` says whether the pupil answered their own confirmation link, composed here rather
 * than left to the reader: an admission is offered on no registration lacking it.
 * `vollstaendig` is false where more rows exist than one read serves. A decision's author is `null`
 * beside `entscheidung.von_gesperrt` where the ban list holds that address, as no barred address is
 * served in plain.
 * @summary List Registrierungen
 */
export const registrierungenGetRegistrierungenQuerySaisonIdOneMin = 4;
export const registrierungenGetRegistrierungenQuerySaisonIdOneMax = 4;

export const registrierungenGetRegistrierungenQueryTeamIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const registrierungenGetRegistrierungenQueryLimitDefault = 1024;
export const registrierungenGetRegistrierungenQueryLimitMax = 1024;

export const registrierungenGetRegistrierungenQuerySortByDefault = `eingereicht_am`;
export const registrierungenGetRegistrierungenQueryOrderDefault = `desc`;

export const RegistrierungenGetRegistrierungenQueryParams = zod.object({
  saison_id: zod
    .union([
      zod.string().min(registrierungenGetRegistrierungenQuerySaisonIdOneMin).max(registrierungenGetRegistrierungenQuerySaisonIdOneMax),
      zod.null(),
    ])
    .optional(),
  team_id: zod.union([zod.string().regex(registrierungenGetRegistrierungenQueryTeamIdOneRegExp), zod.null()]).optional(),
  status: zod.union([zod.enum(["eingereicht", "abgelehnt"]), zod.null()]).optional(),
  limit: zod.int().min(1).max(registrierungenGetRegistrierungenQueryLimitMax).default(registrierungenGetRegistrierungenQueryLimitDefault),
  sort_by: zod.literal("eingereicht_am").default(registrierungenGetRegistrierungenQuerySortByDefault).meta({ title: "Sort By" }),
  order: zod.enum(["asc", "desc"]).default(registrierungenGetRegistrierungenQueryOrderDefault),
});

/**
 * Store one pupil's registration for the team and season the link belongs to, and mint the confirmation link.
 *
 * Everything the league decides -- the team, the season, `status`, `eingereicht_am` and the
 * deadline -- is taken off the invite and the clock and never off the payload. The raw confirmation
 * token is answered for the caller to mail and stored only as a hash; this response is the one
 * place outside the recipient's inbox it ever exists.
 *
 * An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * registration it holds and stores none: a fresh link where no message is known to have reached the
 * inbox and nothing is confirmed, none otherwise. The same key over other details is refused
 * (`REQ-REGISTRIERUNG-011`), and so is a key whose stored address, the one the answer mails, has been
 * banned since (`REQ-REGISTRIERUNG-009`), before any link is minted. A key whose registration the team has since
 * admitted is refused too (`REQ-REGISTRIERUNG-016`) and stores nothing: the pupil is in the squad.
 * @summary Register through a team's link
 */
export const registrierungenPostRegistrierungBodyEmailMax = 254;

export const registrierungenPostRegistrierungBodyNachnameMax = 80;

export const registrierungenPostRegistrierungBodyNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const registrierungenPostRegistrierungBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");
export const registrierungenPostRegistrierungBodyTokenMax = 128;

export const registrierungenPostRegistrierungBodyVornameMax = 80;

export const registrierungenPostRegistrierungBodyVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");

export const RegistrierungenPostRegistrierungBody = zod
  .object({
    email: zod.string().max(registrierungenPostRegistrierungBodyEmailMax),
    nachname: zod
      .string()
      .min(1)
      .max(registrierungenPostRegistrierungBodyNachnameMax)
      .regex(registrierungenPostRegistrierungBodyNachnameRegExp),
    nummer: zod.union([zod.string().regex(registrierungenPostRegistrierungBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    token: zod.string().min(1).max(registrierungenPostRegistrierungBodyTokenMax),
    vorname: zod.string().min(1).max(registrierungenPostRegistrierungBodyVornameMax).regex(registrierungenPostRegistrierungBodyVornameRegExp),
  })
  .describe(
    "One pupil registering through a team's link.\n\nThe league's own fields -- the team, the season, the state, the deadline and the confirmation\nlink -- are taken off the invite and the clock, never off this body.",
  );

/**
 * Record a pupil's own answer for the registration their link opens: their date of birth and the consent record, in one update.
 *
 * Which page the link opens is resolved again here, as the view resolves it. On the new pupil's page the record
 * carries the publication scope they chose, the media answer beside it, the stamp and the wording they were shown.
 * On the returning pupil's page, which asks no choice, it carries the stamp and the wording alone: the choices
 * standing on the person's own record are theirs to change on the account page, and nothing here re-grants one.
 * Its body carries no birthdate: the person's stored one, read here, is judged and written, and the answer echoes
 * null rather than the stored date.
 *
 * Refuses, in this order: a token no registration holds (`REQ-REGISTRIERUNG-004`), a link whose deadline has
 * passed or whose registration has been decided (`-005`), a registration already confirmed (`-006`), any label but
 * the running one of the page the link opens now (`REQ-EINWILLIGUNG-001`), answers that are not the ones that page
 * asks -- both choices and a birthdate on the new pupil's, none of the three on the returning pupil's
 * (`REQ-REGISTRIERUNG-017`) -- a returning pupil's person holding no birthdate to take (`-019`), a link mailed to an
 * address the ban list holds now, whenever the link was minted (`REQ-REGISTRIERUNG-012`), an age below the floor
 * (`-007`), and a media consent from a pupil below `medien_mindestalter` (`REQ-REGISTRIERUNG-010`). Every one is
 * judged before anything is written, so a reloaded page or a mistyped year spends nothing and the pupil keeps the
 * link.
 *
 * The registration stays pending after this: an admission is a later decision, and nothing here writes a person
 * or a squad row.
 * @summary Confirm one registration and record the pupil's consent
 */
export const registrierungenPostBestaetigungBodyGeburtsdatumOneRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const registrierungenPostBestaetigungBodyGeburtsdatumThreeRegExp = new RegExp("^\\s*$");
export const registrierungenPostBestaetigungBodyTextVersionMax = 64;

export const registrierungenPostBestaetigungBodyTokenMax = 128;

export const RegistrierungenPostBestaetigungBody = zod
  .object({
    geburtsdatum: zod.union([
      zod.string().regex(registrierungenPostBestaetigungBodyGeburtsdatumOneRegExp),
      zod.null(),
      zod.string().regex(registrierungenPostBestaetigungBodyGeburtsdatumThreeRegExp),
    ]),
    medien: zod.union([zod.boolean(), zod.null()]),
    text_version: zod.string().min(1).max(registrierungenPostBestaetigungBodyTextVersionMax),
    token: zod.string().min(1).max(registrierungenPostBestaetigungBodyTokenMax),
    umfang: zod.union([zod.enum(["kader_oeffentlich", "intern"]), zod.null()]),
  })
  .describe("One pupil's own answer: their date of birth where the page asks it, and on the new pupil's page the two consents.");

/**
 * Answer what the page renders for the registration this token opens, and no part of the registration beyond it.
 *
 * The link's state, the team and its school, the season, the age floor the press will be judged by, the age from
 * which the media switch is offered, and which of two pages the link opens. Never the pupil's name: the link went to
 * an address nobody has confirmed, which behind a typo is a stranger's.
 *
 * `bestaetigung_spieler_wiederkehrend` is the returning pupil's: a stored person at the registration's folded
 * address under its folded name who confirmed their own record. That page asks no choice and no birthdate, taking
 * the person's own; nothing the person's record holds is served, the holder of a mailed link not yet being known
 * to be that person. Matched on the address alone, a mailbox shared anyway would hand a sibling that person's
 * page, so the name narrows the match.
 *
 * A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
 * registration holds (`REQ-REGISTRIERUNG-004`): a confirmed or an expired link is SERVED in that state rather
 * than refused, so a reopened link shows what became of it. The state is `gesperrt`, ahead of every other, wherever
 * the ban list holds the address the link was mailed to (`REQ-REGISTRIERUNG-012`), so the page offers a barred
 * pupil nothing to press.
 * @summary What one registration confirmation link opens
 */
export const registrierungenGetBestaetigungAnsichtBodyTokenMax = 128;

export const RegistrierungenGetBestaetigungAnsichtBody = zod
  .object({
    token: zod.string().min(1).max(registrierungenGetBestaetigungAnsichtBodyTokenMax),
  })
  .describe("A POST that reads: the token travels in a body, never in a second URL.");

/**
 * Answer what this registration link is for: the team, its school, the season, and what the form may offer.
 *
 * A POST because the link value travels in the body and never in a path the edge would log. A shut
 * window is a STATE here rather than a refusal, so a link opened after the deadline reads as closed
 * rather than as invalid; only a link that opens no live invite is refused.
 * @summary What a registration link opens
 */
export const registrierungenPostEinladungAnsichtBodyTokenMax = 128;

export const RegistrierungenPostEinladungAnsichtBody = zod
  .object({
    token: zod.string().min(1).max(registrierungenPostEinladungAnsichtBodyTokenMax),
  })
  .describe("The link a visitor presents, and nothing else: the row it opens says which team and season it is for.");

/**
 * Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.
 *
 * A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
 * differs. An unconfirmed row names nobody: its address is unproven.
 * No address, telephone number, birthdate or consent record is served for anybody.
 * `vollstaendig` is false where more pending rows exist than `limit` serves.
 * @summary A team's pending registrations for one season
 */
export const registrierungenGetOffeneRegistrierungenPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenGetOffeneRegistrierungenParams = zod.object({
  team_id: zod.string().regex(registrierungenGetOffeneRegistrierungenPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const registrierungenGetOffeneRegistrierungenQueryLimitDefault = 1024;
export const registrierungenGetOffeneRegistrierungenQueryLimitMax = 1024;

export const registrierungenGetOffeneRegistrierungenQueryOrderDefault = `desc`;

export const RegistrierungenGetOffeneRegistrierungenQueryParams = zod.object({
  limit: zod
    .int()
    .min(1)
    .max(registrierungenGetOffeneRegistrierungenQueryLimitMax)
    .default(registrierungenGetOffeneRegistrierungenQueryLimitDefault),
  order: zod.enum(["asc", "desc"]).default(registrierungenGetOffeneRegistrierungenQueryOrderDefault),
});

/**
 * Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.
 *
 * WITHDRAW-ONLY until the admission: a grant is the team's admission's to make possible, after which the pupil's own
 * record takes it on the account page; this one is offered so taking a consent back is as easy as giving it was
 * (Art. 7(3) DSGVO). Writes those two on this one registration, and nothing else: the confirmation day, the day given
 * and the wording the pupil confirmed stand. A PATCH moving neither choice writes nothing, and nothing is counted
 * against the person's ceiling. The admission carries a withdrawal made here onto the person, as it carries every
 * choice the registration set later than the person's own.
 *
 * Refuses, in this order: an id that is no pending registration of this address, confirmed by its pupil and carrying
 * their choices (`REQ-FUNKTION-001`); a `nachweis_stand` other than the registration's own, either choice having
 * moved since the page was served (`REQ-EINWILLIGUNG-003`); a grant of either choice (`REQ-EINWILLIGUNG-004`); and a
 * `text_version` naming no version of the account page's pupil control (`REQ-EINWILLIGUNG-001`). Each refusal writes
 * nothing.
 * @summary Withdraw a pupil's own publication and media consent on their pending registration
 */
export const registrierungenPatchEinwilligungPathRegistrierungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenPatchEinwilligungParams = zod.object({
  registrierung_id: zod.string().regex(registrierungenPatchEinwilligungPathRegistrierungIdRegExp),
});

export const registrierungenPatchEinwilligungBodyTextVersionMax = 64;

export const RegistrierungenPatchEinwilligungBody = zod
  .object({
    medien: zod.boolean(),
    nachweis_stand: zod.object({
      medien: zod.union([zod.string(), zod.null()]),
      umfang: zod.union([zod.string(), zod.null()]),
    }),
    text_version: zod.string().min(1).max(registrierungenPatchEinwilligungBodyTextVersionMax),
    umfang: zod.enum(["kader_oeffentlich", "intern"]),
  })
  .describe("The pupil's own two choices on one pending registration, the pupil's account control's shape: a grant is refused.");

/**
 * Run the four registration retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.
 *
 * A declined registration is erased a month after the decision. Once the season is `past`, every registration still awaiting a
 * decision is erased whatever the pupil answered, because no admission can be taken for a season that is over. The confirmed ones
 * among them are listed in `benachrichtigt` and told AFTERWARDS -- one message saying it happened -- while an unconfirmed one is
 * told neither before nor after, its address never having been confirmed. A call whose erasure names somebody to tell answers once
 * that erasure has committed, so the rest of the season's registrations wait for the next call; the two clocks below do not run
 * for a `past` season, whose own end takes every row they read.
 *
 * Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
 * named that day. Then one reminder per registration at its reminder age, earliest deadline first: a fresh link is minted and
 * `erinnert_am` stamped BEFORE this answers, so a failed send costs one pupil one reminder and never a repeat, and the link already
 * in that inbox stays valid beside the fresh one. One call reminds a bounded share of the registrations due; the rest stay due and
 * the calls after it remind them. A registration whose last message the mail provider refused is not chased at all, and one whose
 * address the ban list holds is sent nothing and has nothing written: it stays due, so every pass asks the ban list for it again
 * until its deadline, and reminds it once a lift comes first; each pass logs how many it withheld, never which. Every removal
 * names this season alone, is made inside a transaction and takes its log rows with it.
 *
 * Whatever a call answers in `erinnerungen` and `benachrichtigt` was committed by its last transactions, so no later step of the same
 * call can answer an error in their place; where the request's deadline cuts them after one has committed, the call answers what
 * committed and warns once.
 *
 * A registration whose write fails, the database refusing it or anything else, or one the answer cannot carry, is passed over
 * alone and logged by id: the rest of its clock's page or share goes, and it stays due, so the next pass meets it again and one
 * failing record holds back no clock and nobody behind it. `fehlgeschlagen` sums the rows each of the four clocks passed over: a
 * day stamped beside a sum that is not zero is a clock passing rows over, not one that ran clean.
 *
 * 404 where no season has the id. Idempotent per day once every due reminder and notice has gone out: a run after that writes
 * nothing, though it logs the count of withheld registrations again.
 *
 * One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
 * answers it beside the application pass's own day. So a day's first call records the day and the rest of that day's calls record
 * nothing.
 * @summary Run one season's registration retention clocks
 */
export const RegistrierungenSweepRegistrierungenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Decline one pending registration, confirmed or not: its state and the decision are written, and nothing else.
 *
 * The decision records the declining seat holder's address and a reason from a closed set, never free text:
 * `andere_person` where the team answered that the registration is not the person its address belongs to. The
 * row stays until the retention sweep erases it a month later. The answer carries the address the pupil's link
 * went to, for the decline mail and nothing else, and whether that address was ever confirmed.
 *
 * Refuses, in this order, a press past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), no pending
 * registration with this id (404) and no seat on its team's season (`REQ-FUNKTION-001`).
 * @summary Decline a registration
 */
export const registrierungenAblehnenPathRegistrierungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenAblehnenParams = zod.object({
  registrierung_id: zod.string().regex(registrierungenAblehnenPathRegistrierungIdRegExp),
});

export const RegistrierungenAblehnenBody = zod
  .object({
    grund: zod.union([zod.literal("andere_person"), zod.null()]),
  })
  .describe("Why the team declines, from a closed set or not at all.");

/**
 * Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.
 *
 * The person survives the season, so the admission first looks for them: the stored person holding the
 * registration's address IS that person, and is updated with the registration's name and, where the new pupil's page
 * asked them, its birthdate and its freshly confirmed consent record: one confirmed on the returning pupil's page
 * leaves the person's own birthdate standing, as an administrator may have corrected it since. Where that person's
 * name or birthdate differs, `spieler_id` must name them (the team said it is the same person). With no such
 * person, `spieler_id` is null for a new one. A retired person comes back. A pending address change of theirs
 * stands, asked over the address this admission proves again.
 *
 * The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker derived
 * today; this person's retired row of this season is rewritten rather than a second one written, whichever team
 * it was on. The registration is deleted and its values redacted from the log in the same transaction, so a second
 * press meets no row. Its submission key moves onto the squad row, so the submission replayed later stores nothing.
 *
 * Refuses, in this order: a press past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), no pending
 * registration with this id (404), no seat on its team's season (`REQ-FUNKTION-001`), a registration the pupil has
 * not confirmed (`REQ-REGISTRIERUNG-013`), an address the ban list holds (`REQ-REGISTRIERUNG-009`, worded to the team
 * as neutrally as to the pupil), a Stufe the season does not offer (`REQ-REGISTRIERUNG-003`), a registration
 * confirmed on the returning pupil's page whose address holds no stored person (`REQ-REGISTRIERUNG-018`: it carries
 * no choice, so it admits nobody, and the pupil registers again), a `spieler_id` that is not the person this
 * registration may be admitted into (`REQ-REGISTRIERUNG-014`), a person already playing in a squad this season
 * (`REQ-REGISTRIERUNG-015`) and a full squad (`REQ-SQUAD-003`). Nothing is written on any of them.
 * @summary Admit a registration into the team's squad
 */
export const registrierungenAufnehmenPathRegistrierungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenAufnehmenParams = zod.object({
  registrierung_id: zod.string().regex(registrierungenAufnehmenPathRegistrierungIdRegExp),
});

export const registrierungenAufnehmenBodySpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenAufnehmenBody = zod
  .object({
    spieler_id: zod.union([zod.string().regex(registrierungenAufnehmenBodySpielerIdOneRegExp), zod.null()]),
  })
  .describe("The team's answer to the question the read asked: the person this registration is admitted into, or none.");

/**
 * List the seasons the public may read, optionally narrowed to `past` or `active`.
 *
 * Unlike the other resources, this does NOT default to the current season. A `future` season is
 * withheld here and served by `GET /saisons/list/admin`.
 * @summary List Saisons
 */
export const saisonsGetSaisonsQueryLimitDefault = 1024;
export const saisonsGetSaisonsQueryLimitMax = 1024;

export const saisonsGetSaisonsQuerySortByDefault = `_id`;
export const saisonsGetSaisonsQueryOrderDefault = `asc`;

export const SaisonsGetSaisonsQueryParams = zod.object({
  status: zod.union([zod.enum(["past", "active", "future"]), zod.null()]).optional(),
  limit: zod.int().min(1).max(saisonsGetSaisonsQueryLimitMax).default(saisonsGetSaisonsQueryLimitDefault),
  sort_by: zod.enum(["_id", "start_date", "end_date"]).default(saisonsGetSaisonsQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(saisonsGetSaisonsQueryOrderDefault),
});

/**
 * Create a season, always `future`.
 *
 * The id is supplied rather than generated -- it is the string every `saison_id` elsewhere
 * references, so reusing one comes back 409. Making the season live is a separate step.
 * @summary Create a Saison
 */
export const saisonsPostSaisonBodyBewerbungOneBisRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyBewerbungOneVonRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyEndDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyIdMin = 4;
export const saisonsPostSaisonBodyIdMax = 4;

export const saisonsPostSaisonBodyIdRegExp = new RegExp("^[0-9]+$");
export const saisonsPostSaisonBodyRegistrierungOneBisRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyRegistrierungOneVonRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyRulesDrawPointsMin = 0;

export const saisonsPostSaisonBodyRulesForfeitErgebnisSiegerToreMin = 0;

export const saisonsPostSaisonBodyRulesForfeitErgebnisVerliererToreMin = 0;

export const saisonsPostSaisonBodyRulesMaxKadergroesseExclusiveMin = 0;

export const saisonsPostSaisonBodyRulesNumberOfGroupsExclusiveMin = 0;
export const saisonsPostSaisonBodyRulesNumberOfGroupsMax = 16;

export const saisonsPostSaisonBodyRulesQualifiersPerGroupExclusiveMin = 0;

export const saisonsPostSaisonBodyRulesTeamsPerGroupMin = 2;
export const saisonsPostSaisonBodyRulesTeamsPerGroupMax = 16;

export const saisonsPostSaisonBodyRulesWinPointsExclusiveMin = 0;

export const saisonsPostSaisonBodyStartDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const SaisonsPostSaisonBody = zod.object({
  bewerbung: zod.union([
    zod
      .object({
        bis: zod.string().regex(saisonsPostSaisonBodyBewerbungOneBisRegExp),
        offen: zod.boolean(),
        von: zod.string().regex(saisonsPostSaisonBodyBewerbungOneVonRegExp),
      })
      .describe(
        "When the league accepts applications for this season.\n\nThe two halves that record it: the span, and the `offen` flag an administrator sets beside it.",
      ),
    zod.null(),
  ]),
  end_date: zod.string().regex(saisonsPostSaisonBodyEndDateRegExp),
  id: zod.string().min(saisonsPostSaisonBodyIdMin).max(saisonsPostSaisonBodyIdMax).regex(saisonsPostSaisonBodyIdRegExp),
  registrierung: zod.union([
    zod
      .object({
        bis: zod.string().regex(saisonsPostSaisonBodyRegistrierungOneBisRegExp),
        offen: zod.boolean(),
        von: zod.string().regex(saisonsPostSaisonBodyRegistrierungOneVonRegExp),
      })
      .describe(
        "When a pupil may register for this season.\n\nIts own model rather than an alias of `FLSaisonBewerbung` above: the two windows are two\ndecisions an administrator takes apart, and one component name on both would publish them as one.",
      ),
    zod.null(),
  ]),
  rules: zod.object({
    draw_points: zod.int().min(saisonsPostSaisonBodyRulesDrawPointsMin),
    erlaubte_stufen: zod.array(zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"])).min(1),
    forfeit_ergebnis: zod
      .object({
        sieger_tore: zod.int().min(saisonsPostSaisonBodyRulesForfeitErgebnisSiegerToreMin),
        verlierer_tore: zod.int().min(saisonsPostSaisonBodyRulesForfeitErgebnisVerliererToreMin),
      })
      .describe(
        "What a fixture is awarded when one side does not appear.\n\nBoth sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.\nA LEVEL award needs a season with no knockout round (`REQ-RULES-010`).",
      ),
    max_kadergroesse: zod.int().gt(saisonsPostSaisonBodyRulesMaxKadergroesseExclusiveMin),
    number_of_groups: zod.int().gt(saisonsPostSaisonBodyRulesNumberOfGroupsExclusiveMin).max(saisonsPostSaisonBodyRulesNumberOfGroupsMax),
    qualifiers_per_group: zod.int().gt(saisonsPostSaisonBodyRulesQualifiersPerGroupExclusiveMin),
    teams_per_group: zod.int().min(saisonsPostSaisonBodyRulesTeamsPerGroupMin).max(saisonsPostSaisonBodyRulesTeamsPerGroupMax),
    tiebreak_order: zod.enum(["tordifferenz", "direkter_vergleich"]),
    win_points: zod.int().gt(saisonsPostSaisonBodyRulesWinPointsExclusiveMin),
  }),
  start_date: zod.string().regex(saisonsPostSaisonBodyStartDateRegExp),
});

/**
 * List every season, the `future` ones `GET /saisons` withholds included.
 *
 * The admin surfaces read here because a season is created `future` and clubs are entered while it
 * still is, so an admin who cannot see one cannot run the league.
 * @summary Every Saison for the admin surfaces
 */
export const saisonsGetSaisonsForAdminQueryLimitDefault = 1024;
export const saisonsGetSaisonsForAdminQueryLimitMax = 1024;

export const saisonsGetSaisonsForAdminQuerySortByDefault = `_id`;
export const saisonsGetSaisonsForAdminQueryOrderDefault = `asc`;

export const SaisonsGetSaisonsForAdminQueryParams = zod.object({
  status: zod.union([zod.enum(["past", "active", "future"]), zod.null()]).optional(),
  limit: zod.int().min(1).max(saisonsGetSaisonsForAdminQueryLimitMax).default(saisonsGetSaisonsForAdminQueryLimitDefault),
  sort_by: zod.enum(["_id", "start_date", "end_date"]).default(saisonsGetSaisonsForAdminQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(saisonsGetSaisonsForAdminQueryOrderDefault),
});

/**
 * Return one season by its id; 404 when none carries it, rather than an empty list.
 *
 * A `future` season is one of those: it is withheld from this tier by the FILTER, so the miss is a
 * genuine one and nothing here has to know it was withheld.
 * @summary One Saison
 */
export const SaisonsGetSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Update a season's dates and rules. `status` is on no payload.
 *
 * Editing the points moves every league table on the NEXT READ, standings being derived. What a
 * finished or drawn season has fixed is refused, as is a rule narrowed below what it holds.
 * @summary Update a Saison's dates and rules
 */
export const SaisonsPatchSaisonParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsPatchSaisonBodyBewerbungOneBisRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyBewerbungOneVonRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyEndDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyRegistrierungOneBisRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyRegistrierungOneVonRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyRulesDrawPointsMin = 0;

export const saisonsPatchSaisonBodyRulesForfeitErgebnisSiegerToreMin = 0;

export const saisonsPatchSaisonBodyRulesForfeitErgebnisVerliererToreMin = 0;

export const saisonsPatchSaisonBodyRulesMaxKadergroesseExclusiveMin = 0;

export const saisonsPatchSaisonBodyRulesNumberOfGroupsExclusiveMin = 0;
export const saisonsPatchSaisonBodyRulesNumberOfGroupsMax = 16;

export const saisonsPatchSaisonBodyRulesQualifiersPerGroupExclusiveMin = 0;

export const saisonsPatchSaisonBodyRulesTeamsPerGroupMin = 2;
export const saisonsPatchSaisonBodyRulesTeamsPerGroupMax = 16;

export const saisonsPatchSaisonBodyRulesWinPointsExclusiveMin = 0;

export const saisonsPatchSaisonBodyStartDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const SaisonsPatchSaisonBody = zod.object({
  bewerbung: zod.union([
    zod
      .object({
        bis: zod.string().regex(saisonsPatchSaisonBodyBewerbungOneBisRegExp),
        offen: zod.boolean(),
        von: zod.string().regex(saisonsPatchSaisonBodyBewerbungOneVonRegExp),
      })
      .describe(
        "When the league accepts applications for this season.\n\nThe two halves that record it: the span, and the `offen` flag an administrator sets beside it.",
      ),
    zod.null(),
  ]),
  end_date: zod.string().regex(saisonsPatchSaisonBodyEndDateRegExp),
  registrierung: zod.union([
    zod
      .object({
        bis: zod.string().regex(saisonsPatchSaisonBodyRegistrierungOneBisRegExp),
        offen: zod.boolean(),
        von: zod.string().regex(saisonsPatchSaisonBodyRegistrierungOneVonRegExp),
      })
      .describe(
        "When a pupil may register for this season.\n\nIts own model rather than an alias of `FLSaisonBewerbung` above: the two windows are two\ndecisions an administrator takes apart, and one component name on both would publish them as one.",
      ),
    zod.null(),
  ]),
  rules: zod.object({
    draw_points: zod.int().min(saisonsPatchSaisonBodyRulesDrawPointsMin),
    erlaubte_stufen: zod.array(zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"])).min(1),
    forfeit_ergebnis: zod
      .object({
        sieger_tore: zod.int().min(saisonsPatchSaisonBodyRulesForfeitErgebnisSiegerToreMin),
        verlierer_tore: zod.int().min(saisonsPatchSaisonBodyRulesForfeitErgebnisVerliererToreMin),
      })
      .describe(
        "What a fixture is awarded when one side does not appear.\n\nBoth sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.\nA LEVEL award needs a season with no knockout round (`REQ-RULES-010`).",
      ),
    max_kadergroesse: zod.int().gt(saisonsPatchSaisonBodyRulesMaxKadergroesseExclusiveMin),
    number_of_groups: zod.int().gt(saisonsPatchSaisonBodyRulesNumberOfGroupsExclusiveMin).max(saisonsPatchSaisonBodyRulesNumberOfGroupsMax),
    qualifiers_per_group: zod.int().gt(saisonsPatchSaisonBodyRulesQualifiersPerGroupExclusiveMin),
    teams_per_group: zod.int().min(saisonsPatchSaisonBodyRulesTeamsPerGroupMin).max(saisonsPatchSaisonBodyRulesTeamsPerGroupMax),
    tiebreak_order: zod.enum(["tordifferenz", "direkter_vergleich"]),
    win_points: zod.int().gt(saisonsPatchSaisonBodyRulesWinPointsExclusiveMin),
  }),
  start_date: zod.string().regex(saisonsPatchSaisonBodyStartDateRegExp),
});

/**
 * Make this the active season, moving whichever holds `active` to `past` in one transaction.
 *
 * The only path to `status: "active"`. The outgoing season must be finished, a `past` target is
 * refused, and every matchday of the target carries a date.
 * @summary Make this the active Saison
 */
export const SaisonsActivateSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Mint one registration link per admitted team of this season and answer each team's raw link once, for the caller to mail.
 *
 * **Every team mailed is minted for, and any link that team already held is REVOKED in the same per-team transaction** — the copy in
 * somebody's inbox opens nothing from that moment. A stored link is a hash, so the value to put in a message is one that has just been
 * made; there is nothing to re-send. `ersetzt_link` says of each row whether a link died for it, and the preview answers it before the
 * press. A team this skips is left exactly as it was.
 *
 * Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that block
 * has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link already carries a delivery
 * record and `erneut` is false. **The ban is read once ahead of every team**, so a team the mailer could reach nobody of keeps the link it
 * holds rather than losing it to a press that mails nobody. **The fifth is read off
 * the delivery record**, which only `POST /zustellung/angenommen` writes — so pressing twice mails nobody twice, while a link minted and
 * never sent is still sent. **The first is read off the junction row's `austritt` record**, so a team out of the season by either route is
 * passed over; minting for one team by hand is not refused, that being a deliberate act rather than a bulk one.
 *
 * The answer carries the raw link per team and is the only place each appears. Refused where the season has ended (`REQ-EINLADUNG-002`);
 * 404 where no season holds that id; a season holding no team answers an empty list.
 *
 * **An administrator whose access is revoked while the mailing runs is refused `REQ-AUTH-006` at the next team**, and the answer
 * carries no link at all: every team minted for before that point has lost the link it held and holds one nobody was sent. Running the
 * mailing again, as an administrator who still holds access, mints and answers those teams' links anew, none of them carrying a
 * delivery record yet.
 * @summary Mint every admitted team a link
 */
export const SaisonsPostEinladungenVersandParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsPostEinladungenVersandBodyErneutDefault = false;

export const SaisonsPostEinladungenVersandBody = zod.object({
  erneut: zod.boolean().default(saisonsPostEinladungenVersandBodyErneutDefault),
});

/**
 * Per team of this season, the mailboxes the send would write to and the reason it would skip a team — and it writes nothing itself.
 *
 * Decided by the function the send itself decides by, so the list read here is the list performed. `erneut` mirrors the send's own
 * switch: left false, a team whose live link already carries a delivery record reads as `bereits_gesendet`, and pressing the send with
 * `erneut` true instead makes this preview's own answer wrong unless the same value is asked for here.
 *
 * **`ersetzt_link` is the warning this list carries**: the send mints for every team it answers, so a team already holding a link has that
 * link REVOKED and the copy in somebody's inbox opens nothing from that moment. A row carries no trace of the invitation the team holds,
 * so a page offering the press reads that fact here or nowhere.
 *
 * Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that
 * block has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link already carries a
 * delivery record and `erneut` is false. A season holding
 * no team answers an empty list. One row per MAILBOX, so a person sitting in two seats is named once. 404 where no season holds that id.
 * @summary Who the send would reach
 */
export const SaisonsPreviewEinladungenVersandParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsPreviewEinladungenVersandQueryErneutDefault = false;

export const SaisonsPreviewEinladungenVersandQueryParams = zod.object({
  erneut: zod.boolean().default(saisonsPreviewEinladungenVersandQueryErneutDefault),
});

/**
 * Exchange the groups of two clubs entered in this season, as one write.
 *
 * Every Gruppenphase fixture fielding either club has that side rewritten in the same transaction,
 * so each group stays a round robin. Neither `tore` nor `austritt` moves.
 * @summary Exchange two teams' groups
 */
export const SaisonsSwapGruppenParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsSwapGruppenBodyTeam1IdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const saisonsSwapGruppenBodyTeam2IdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SaisonsSwapGruppenBody = zod
  .object({
    team1_id: zod.string().regex(saisonsSwapGruppenBodyTeam1IdRegExp),
    team2_id: zod.string().regex(saisonsSwapGruppenBodyTeam2IdRegExp),
  })
  .describe(
    "The two clubs a group swap exchanges. Symmetric.\n\nNeither side carries a `gruppe`: reading one from the payload would let a stale form write a\ngroup nobody stands in.",
  );

/**
 * How many pupils `POST /identitaet/loeschung/lauf` deletes once this season is activated, and which season that activation closes.
 *
 * Judged by the run's own rule over the statuses the activation leaves: the season now `active` turned `past`, this one
 * `active`, every other as it stands. A count and never a name, and writes nothing. It judges none of the activation's own
 * refusals, and the people it counts are those due at this moment: a squad row or a registration arriving before the run
 * keeps its pupil, and a pupil whose stored address no request matches is counted though the run passes them over.
 * `abgeschlossene_saison_id` is null where no season but this one is `active`. 404 where no season holds that id.
 * @summary How many pupils activating this season would delete
 */
export const SaisonsPreviewLoeschungParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Return the season to undrawn: matchdays, fixtures and watermark, in one transaction.
 *
 * Every fixture's confirmations go with it.
 *
 * The replace's window bounds it (`REQ-SPIELPLAN-006`), and a submitted match report refuses it
 * (`REQ-SPIELPLAN-007`). Undoing the draw is what reopens the shape rules to `PATCH` and the groups to
 * an entry.
 * @summary Undraw this Saison's Spielplan
 */
export const SaisonsUndrawSpielplanParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Draw the whole season at once: every matchday and every fixture, undated, in one transaction.
 *
 * `shape` states the three rules the fixtures come out of, and is stored with them. `replace`
 * deletes both lists first, every fixture's confirmations with them, inside `REQ-SPIELPLAN-005`'s
 * window and on a season holding no submitted match report (`REQ-SPIELPLAN-007`), and is refused
 * `REQ-AUTH-009` from a sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`: nothing writes
 * the removed rows back.
 * @summary Draw this Saison's Spielplan
 */
export const SaisonsGenerateSpielplanParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsGenerateSpielplanBodyReplaceDefault = false;
export const saisonsGenerateSpielplanBodyShapeOneNumberOfGroupsExclusiveMin = 0;
export const saisonsGenerateSpielplanBodyShapeOneNumberOfGroupsMax = 16;

export const saisonsGenerateSpielplanBodyShapeOneQualifiersPerGroupExclusiveMin = 0;

export const saisonsGenerateSpielplanBodyShapeOneTeamsPerGroupMin = 2;
export const saisonsGenerateSpielplanBodyShapeOneTeamsPerGroupMax = 16;

export const SaisonsGenerateSpielplanBody = zod
  .object({
    replace: zod.boolean().default(saisonsGenerateSpielplanBodyReplaceDefault),
    shape: zod
      .union([
        zod
          .object({
            number_of_groups: zod
              .int()
              .gt(saisonsGenerateSpielplanBodyShapeOneNumberOfGroupsExclusiveMin)
              .max(saisonsGenerateSpielplanBodyShapeOneNumberOfGroupsMax),
            qualifiers_per_group: zod.int().gt(saisonsGenerateSpielplanBodyShapeOneQualifiersPerGroupExclusiveMin),
            teams_per_group: zod
              .int()
              .min(saisonsGenerateSpielplanBodyShapeOneTeamsPerGroupMin)
              .max(saisonsGenerateSpielplanBodyShapeOneTeamsPerGroupMax),
          })
          .describe(
            "The three rules a season's fixture list is a function of, as this draw is to run from.\n\nAll three or none: the draw is one function of the whole shape, and a payload naming half\nof it would take the rest off a season about to stop matching it.",
          ),
        zod.null(),
      ])
      .optional(),
  })
  .describe(
    "Whether this draw may REPLACE what the season already holds, and the shape it runs from.\n\nAn absent body is a first draw off the season's own rules: nothing is destroyed and no\nnumber moves by omission. `REQ-SPIELPLAN-005` bounds a confirmed one.",
  );

/**
 * An admin-tier read: a referee is a pupil, so their contact and school are private (`READ-CONTACT-001`).
 *
 * The fee is admin-tier as money, not as a pupil's detail (`READ-MONEY-001`). Deactivated ones
 * stay retrievable for a historical match.
 *
 * The ghost is OFF this list whatever the query string asks for: no person stands behind it, so
 * there is nothing an administrator could book it for, edit on it or reactivate it into
 * (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
 * @summary List Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichterQueryIncludeInactiveDefault = false;
export const schiedsrichterGetSchiedsrichterQueryLimitDefault = 1024;
export const schiedsrichterGetSchiedsrichterQueryLimitMax = 1024;

export const schiedsrichterGetSchiedsrichterQuerySortByDefault = `name`;
export const schiedsrichterGetSchiedsrichterQueryOrderDefault = `asc`;

export const SchiedsrichterGetSchiedsrichterQueryParams = zod.object({
  default_payment: zod.union([zod.int(), zod.null()]).optional(),
  include_inactive: zod.boolean().default(schiedsrichterGetSchiedsrichterQueryIncludeInactiveDefault),
  limit: zod.int().min(1).max(schiedsrichterGetSchiedsrichterQueryLimitMax).default(schiedsrichterGetSchiedsrichterQueryLimitDefault),
  sort_by: zod.enum(["name", "default_payment"]).default(schiedsrichterGetSchiedsrichterQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(schiedsrichterGetSchiedsrichterQueryOrderDefault),
});

/**
 * Create a referee and mint their confirmation link.
 *
 * `inactive_since` is set to null here and is on no payload. **Entering a referee IS the
 * invitation**: the payload requires an email address, and there is no second press deciding
 * whether this person is asked, because a referee nobody asked is a name nobody consented to
 * publish. The raw token is answered once, for the caller to mail, and the row stores only its hash.
 *
 * Refused `REQ-SCHIEDSRICHTER-007` where the address given is on the ban list.
 * @summary Create a Schiedsrichter
 */
export const schiedsrichterPostSchiedsrichterBodyDefaultPaymentMin = 0;

export const schiedsrichterPostSchiedsrichterBodyKontaktEmailMax = 254;

export const schiedsrichterPostSchiedsrichterBodyKontaktTelefonOneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const schiedsrichterPostSchiedsrichterBodyKontaktTelefonThreeRegExp = new RegExp("^\\s*$");
export const schiedsrichterPostSchiedsrichterBodyNameMax = 80;

export const schiedsrichterPostSchiedsrichterBodyNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");

export const SchiedsrichterPostSchiedsrichterBody = zod.object({
  default_payment: zod.int().min(schiedsrichterPostSchiedsrichterBodyDefaultPaymentMin),
  kontakt: zod.object({
    email: zod.string().max(schiedsrichterPostSchiedsrichterBodyKontaktEmailMax),
    telefon: zod.union([
      zod.string().regex(schiedsrichterPostSchiedsrichterBodyKontaktTelefonOneRegExp),
      zod.null(),
      zod.string().regex(schiedsrichterPostSchiedsrichterBodyKontaktTelefonThreeRegExp),
    ]),
  }),
  name: zod.string().min(1).max(schiedsrichterPostSchiedsrichterBodyNameMax).regex(schiedsrichterPostSchiedsrichterBodyNameRegExp),
  schule: zod.union([zod.string(), zod.null()]),
});

/**
 * Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.
 *
 * The consent carries the publication scope they chose, the media answer beside it, the stamp and the wording they were
 * shown. It reaches this one collection and writes nothing on any fixture: a referee's publication scope has one home,
 * which the fixture list joins at read time to decide whether to publish the name each fixture stores.
 *
 * Refuses, in this order: a token no referee holds (`REQ-SCHIEDSRICHTER-002`), an entry already confirmed
 * (`REQ-SCHIEDSRICHTER-004`), a link whose deadline has passed (`REQ-SCHIEDSRICHTER-003`), any label but the referee
 * page's running one (`REQ-EINWILLIGUNG-001`), a link mailed to an address the ban list holds now, whenever the link
 * was minted (`REQ-SCHIEDSRICHTER-009`), an age outside what this consent asks (`REQ-SCHIEDSRICHTER-005`), and a media
 * consent from a referee below `medien_mindestalter` (`REQ-SCHIEDSRICHTER-008`) -- the label and the last two judged
 * before anything is written, so a reloaded page or a mistyped year spends nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this record. Nothing here can:
 * a withheld name would go on being served for as long as that entry lives.
 * @summary Confirm one Schiedsrichter's entry and consent
 */
export const schiedsrichterPostBestaetigungBodyGeburtsdatumRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const schiedsrichterPostBestaetigungBodyTextVersionMax = 64;

export const schiedsrichterPostBestaetigungBodyTokenMax = 128;

export const SchiedsrichterPostBestaetigungBody = zod.object({
  geburtsdatum: zod.string().regex(schiedsrichterPostBestaetigungBodyGeburtsdatumRegExp),
  medien: zod.boolean(),
  text_version: zod.string().min(1).max(schiedsrichterPostBestaetigungBodyTextVersionMax),
  token: zod.string().min(1).max(schiedsrichterPostBestaetigungBodyTokenMax),
  umfang: zod.enum(["kader_oeffentlich", "intern"]),
});

/**
 * Answer what this token opens: the link's state and deadline, and both age floors.
 *
 * **Nothing else** (`READ-REFEREE-002`): never a name, the school, the contact details, the fee, the birthdate or the
 * entry's id, all of which are behind `READ-CONTACT-001`. The link went to an address an administrator typed and nobody has
 * confirmed, which behind a typo is a stranger's. A POST that reads, so the token travels in a body and never in a second
 * URL.
 *
 * Refuses only a token no referee holds (`REQ-SCHIEDSRICHTER-002`): a confirmed or an expired link
 * is SERVED in that state rather than refused, so a reopened link shows what became of it. The state is `gesperrt`,
 * ahead of every other, wherever the ban list holds the address the link was mailed to (`REQ-SCHIEDSRICHTER-009`),
 * so the page offers a barred referee nothing to press.
 * @summary What one Schiedsrichter confirmation link opens
 */
export const schiedsrichterGetBestaetigungAnsichtBodyTokenMax = 128;

export const SchiedsrichterGetBestaetigungAnsichtBody = zod.object({
  token: zod.string().min(1).max(schiedsrichterGetBestaetigungAnsichtBodyTokenMax),
});

/**
 * Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.
 *
 * Writes those two on this one referee row, each moved choice with its evidence (`nachweis.<choice>`), and nothing
 * else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
 * public fixture list reads the scope off this row, so a withdrawal takes the name off every fixture page at that
 * list's next read. A PATCH moving neither choice writes nothing. A GRANT (`umfang` to
 * `kader_oeffentlich` or `medien` to `true`) is taken on a live record alone; a withdrawal on a retired one too.
 *
 * Refuses, in this order: an id that is no confirmed referee record of this address (`REQ-FUNKTION-001`); a
 * `nachweis_stand` other than the record's own, either choice having moved since the page was served
 * (`REQ-EINWILLIGUNG-003`); a grant on a retired record (`REQ-EINWILLIGUNG-004`); a `text_version` naming no version of
 * the account page's referee control, or a grant naming any but the page's running one (`REQ-EINWILLIGUNG-001`);
 * `medien` moving to `true` where the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing
 * (`REQ-EINWILLIGUNG-002`); and a grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), which
 * counts grants alone, so a withdrawal is never refused for it. Each refusal writes nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this row; nothing here can.
 * @summary Change a signed-in referee's own publication and media consent
 */
export const schiedsrichterPatchEinwilligungPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterPatchEinwilligungParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterPatchEinwilligungPathSchiedsrichterIdRegExp),
});

export const schiedsrichterPatchEinwilligungBodyTextVersionMax = 64;

export const SchiedsrichterPatchEinwilligungBody = zod.object({
  medien: zod.boolean(),
  nachweis_stand: zod.object({
    medien: zod.union([zod.string(), zod.null()]),
    umfang: zod.union([zod.string(), zod.null()]),
  }),
  text_version: zod.string().min(1).max(schiedsrichterPatchEinwilligungBodyTextVersionMax),
  umfang: zod.enum(["kader_oeffentlich", "intern"]),
});

/**
 * Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy.
 * @summary Deactivate a Schiedsrichter (soft delete)
 */
export const schiedsrichterDeleteSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterDeleteSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterDeleteSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * Admin-tier as the list is, and for the same two rules (`READ-CONTACT-001`, `READ-MONEY-001`).
 *
 * Deactivated ones included -- a historical match references them by id. The ghost answers 404, as
 * does an id whose referee has been erased: the document is gone
 * (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
 *
 * Answers whether the consent link's deadline has passed today, by the rule its press refuses on, so the editor marks a
 * lapsed link without reading a clock of its own; and the live change of the referee's address, which the address tool shows,
 * beside why the tool refuses it this administrator, null where it opens it.
 * @summary One Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichterByIdPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterGetSchiedsrichterByIdParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterGetSchiedsrichterByIdPathSchiedsrichterIdRegExp),
});

/**
 * Update a referee, then update the embedded name on every Spiel that uses them.
 *
 * Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.
 *
 * **A corrected address on an UNCONFIRMED referee retires their link and answers a fresh one** in
 * `bestaetigung`, for the caller to mail to the new address: the old link was posted to a mailbox
 * nobody reads, and leaving it live is a credential in the wrong inbox.
 *
 * **A CONFIRMED referee's address is refused here** (`REQ-SCHIEDSRICHTER-011`), retired or not: it is who signs in as the
 * person, and moves only through an address change: the address tool, `POST /adresswechsel`, or the person's own account page.
 * A save keeping it lands, a pending change standing.
 *
 * **A RETIRED unconfirmed referee's corrected address is stored and mails nothing**: no consent is
 * collected for a role nobody gives them. Their old link is retired all the same, and the
 * reactivation mints the fresh one. Where a link is minted, a banned new address is refused
 * `REQ-SCHIEDSRICHTER-007`. A save retiring or minting a link is refused `REQ-AUTH-009` from a
 * sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`.
 *
 * The ghost answers 404 here as it does to every read: a name written onto it would appear on the
 * fixtures of every referee already erased.
 * @summary Update a Schiedsrichter and fan the change out
 */
export const schiedsrichterPatchSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterPatchSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterPatchSchiedsrichterPathSchiedsrichterIdRegExp),
});

export const schiedsrichterPatchSchiedsrichterBodyDefaultPaymentMin = 0;

export const schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax = 254;

export const schiedsrichterPatchSchiedsrichterBodyKontaktTelefonOneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const schiedsrichterPatchSchiedsrichterBodyKontaktTelefonThreeRegExp = new RegExp("^\\s*$");
export const schiedsrichterPatchSchiedsrichterBodyNameMax = 80;

export const schiedsrichterPatchSchiedsrichterBodyNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");

export const SchiedsrichterPatchSchiedsrichterBody = zod.object({
  default_payment: zod.int().min(schiedsrichterPatchSchiedsrichterBodyDefaultPaymentMin),
  kontakt: zod.object({
    email: zod.string().max(schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax),
    telefon: zod.union([
      zod.string().regex(schiedsrichterPatchSchiedsrichterBodyKontaktTelefonOneRegExp),
      zod.null(),
      zod.string().regex(schiedsrichterPatchSchiedsrichterBodyKontaktTelefonThreeRegExp),
    ]),
  }),
  name: zod.string().min(1).max(schiedsrichterPatchSchiedsrichterBodyNameMax).regex(schiedsrichterPatchSchiedsrichterBodyNameRegExp),
  schule: zod.union([zod.string(), zod.null()]),
});

/**
 * Mint a fresh confirmation link for this referee and answer the raw token once, for the caller to mail.
 *
 * It replaces the whole block, so the previous link stops working at once and the delivery state
 * of the message that link went out in goes with it — a bounce recorded against a replaced address
 * would otherwise hold the fresh link's referee unreachable for ever. The deadline restarts from
 * today.
 *
 * Refused where the referee is retired (`REQ-SCHIEDSRICHTER-001`), where they have already
 * answered (`REQ-SCHIEDSRICHTER-004`), where they carry no email address
 * (`REQ-SCHIEDSRICHTER-006`), and where that address is on the ban list
 * (`REQ-SCHIEDSRICHTER-007`). 404 for an id no referee holds, an erased referee's among them, and
 * for the ghost, which every by-id route filters out.
 *
 * **A referee who has already answered is refused rather than sent a second link**: the
 * confirmation refuses every such press, so minting one would replace a live block with a
 * credential that can never be spent.
 * @summary Send a Schiedsrichter a fresh confirmation link
 */
export const schiedsrichterEinladenSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterEinladenSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterEinladenSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * Clear `inactive_since`, putting the referee back into the picker and every default read.
 *
 * **A retired referee who has not answered is minted a fresh link**, answered once for the caller
 * to mail: a retired referee's save stores a new address and mails nothing, so coming back is what
 * asks them. A row holding no address a link can go to comes back unasked, and so does one whose
 * person has answered. Where a link is minted, an address on the ban list is refused
 * `REQ-SCHIEDSRICHTER-007` and the row stays retired, and one from a sign-in or confirmation older than
 * `STEP_UP_WINDOW_HOURS` is refused `REQ-AUTH-009`.
 *
 * The ghost answers 404 here too: cleared on it, the picker would offer a bookable row with no
 * person behind it.
 * @summary Bring a deactivated Schiedsrichter back
 */
export const schiedsrichterReactivateSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterReactivateSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterReactivateSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * Ban an address from signing up. The address is hashed under the backend key and dropped; no row and no log line holds it.
 *
 * Refused where the list already holds the address (`REQ-SPERRLISTE-001`), while no season is
 * running, there being nothing to count the ban's five seasons from (`REQ-SPERRLISTE-002`), and
 * where the address is an administrator's (`REQ-SPERRLISTE-003`). The ban covers the
 * fifth season after the one running now — the last one it covers is answered as
 * `gesperrt_bis_saison_id` — and it survives that person's erasure. Every grant notice still queued
 * for the address loses the address in the same transaction.
 *
 * `grund` is served, mailed to the address and kept past that person's erasure, so it is refused 422 where it holds a
 * name of the address's own records, as `POST /identitaet/erasure/ansicht` names each (`REQ-SPERRLISTE-004`). It is
 * matched as that erasure's `anlass` is: as stored, spacing aside, and equal where the plain lower or the plain upper case
 * is, so „Weiss“ is refused for „Weiß“ and another spelling such as „Mueller“ for „Müller“ passes.
 * @summary Ban an email address
 */
export const sperrlistePostSperrlisteEintragBodyEmailMax = 254;

export const sperrlistePostSperrlisteEintragBodyGrundMax = 500;

export const sperrlistePostSperrlisteEintragBodyGrundRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SperrlistePostSperrlisteEintragBody = zod.object({
  email: zod.string().max(sperrlistePostSperrlisteEintragBodyEmailMax),
  grund: zod.string().min(1).max(sperrlistePostSperrlisteEintragBodyGrundMax).regex(sperrlistePostSperrlisteEintragBodyGrundRegExp),
});

/**
 * Lift a ban before it lapses, removing the row. HARD, no soft form.
 *
 * Nothing reverses it from here: the address a row was taken from cannot be recovered out of the
 * hash, so re-entering the ban means being told the address again. 404 where no row holds the id.
 *
 * **The action log keeps a copy of the removed row** — the hash, its key label, the reason and the
 * administrator who entered it, and no address of the person it barred — for the twelve months
 * the rule gives every log row. The lifted ban is therefore readable
 * at `GET /aktionen` for that period and enforced by nothing from the moment this answers.
 * @summary Lift a ban
 */
export const sperrlisteDeleteSperrlisteEintragPathSperrlisteIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SperrlisteDeleteSperrlisteEintragParams = zod.object({
  sperrliste_id: zod.string().regex(sperrlisteDeleteSperrlisteEintragPathSperrlisteIdRegExp),
});

/**
 * Every report of one season holding a block, each with its state against its fixture and what it proposes.
 *
 * What the season editor counts before an undraw or a replace, which a submitted report refuses
 * (`REQ-SPIELPLAN-007`). Scoped to `saison_id`, the active season when none is named, which answers 404 while no
 * season is active.
 * @summary Every report of a season and the state it reads in
 */
export const SpielberichteGetSpielberichteQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
});

/**
 * Write the whole report of one fixture as an administrator, replacing what stood, as the referee's own write does.
 *
 * Every write changing it raises its `version`, so a report adopted before reads `abweichend` until it is adopted
 * again, and a write changing nothing writes nothing. Who first wrote the report stays recorded; a report an
 * administrator writes first records an administrator, naming nobody.
 *
 * `bericht_stand` is the `version` of the report the page was served, null where none stood, as on the referee's
 * write.
 *
 * Refuses, in this order, each writing nothing: a fixture that does not exist (`DB-COMMON-001`); a `bericht_stand`
 * other than the version standing now, or than none where none stands (`REQ-BERICHT-006`); one undated or whose day is
 * still to come (`REQ-BERICHT-001`); one called off or struck out (`REQ-BERICHT-004`); a shoot-out proposed on a
 * group-phase fixture (`REQ-BERICHT-009`); a pupil newly named on a side outside that side's live squad of the season
 * (`REQ-BERICHT-003`); a yellow or second yellow card naming no reason, unless the stored report holds that card, by
 * side, pupil and colour, stripped of its reason at the end of the season after the match (`REQ-BERICHT-008`); and remarks naming a seat
 * holder of either club, the booked referee or a pupil of either squad (`REQ-BERICHT-005`), last. Each but
 * `REQ-BERICHT-006` is asked again outside the transaction just before answering; a write of the report landing
 * mid-press conflicts with this one, whose retry meets `REQ-BERICHT-006`. Two first writes at once are two pages
 * opened on no report: the later is refused.
 * @summary Write one fixture's report as an administrator
 */
export const spielberichtePatchSpielberichtPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichtePatchSpielberichtParams = zod.object({
  spiel_id: zod.string().regex(spielberichtePatchSpielberichtPathSpielIdRegExp),
});

export const spielberichtePatchSpielberichtBodyBerichtBemerkungenOneMax = 2000;

export const spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam1Min = 0;

export const spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam2Min = 0;

export const spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagTeam1ToreOneMin = 0;

export const spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagTeam2ToreOneMin = 0;

export const spielberichtePatchSpielberichtBodyBerichtKartenItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePatchSpielberichtBodyBerichtKartenItemSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePatchSpielberichtBodyBerichtKartenMax = 60;

export const spielberichtePatchSpielberichtBodyBerichtTorschuetzenItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePatchSpielberichtBodyBerichtTorschuetzenItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePatchSpielberichtBodyBerichtTorschuetzenMax = 60;

export const SpielberichtePatchSpielberichtBody = zod
  .object({
    bericht: zod.object({
      bemerkungen: zod.union([zod.string().min(1).max(spielberichtePatchSpielberichtBodyBerichtBemerkungenOneMax), zod.null()]),
      ergebnis_vorschlag: zod
        .object({
          elfmeterschiessen: zod.union([
            zod
              .object({
                team1: zod.int().min(spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam1Min),
                team2: zod.int().min(spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam2Min),
              })
              .describe("The penalty shoot-out that settled a level knockout fixture: the side with more goals in it won."),
            zod.null(),
          ]),
          sonderereignis: zod.union([zod.enum(["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"]), zod.null()]),
          team1_tore: zod.union([zod.int().min(spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagTeam1ToreOneMin), zod.null()]),
          team2_tore: zod.union([zod.int().min(spielberichtePatchSpielberichtBodyBerichtErgebnisVorschlagTeam2ToreOneMin), zod.null()]),
        })
        .describe(
          "The referee's proposed result, which only the administrator's own save applies.\n\nBoth counts null on a no-show alone: the save composes its goals from the season's forfeit, which typed goals\ncould never equal.",
        ),
      karten: zod
        .array(
          zod
            .object({
              farbe: zod.enum(["gelb", "gelb_rot", "rot"]),
              grund: zod.union([
                zod.enum([
                  "foulspiel",
                  "unsportlichkeit",
                  "handspiel",
                  "meckern",
                  "spielverzoegerung",
                  "wiederholtes_foulspiel",
                  "grobes_foulspiel",
                  "taetlichkeit",
                  "beleidigung",
                  "notbremse",
                ]),
                zod.null(),
              ]),
              minute: zod.string().regex(spielberichtePatchSpielberichtBodyBerichtKartenItemMinuteRegExp),
              seite: zod.enum(["team1", "team2"]),
              spieler_id: zod.string().regex(spielberichtePatchSpielberichtBodyBerichtKartenItemSpielerIdRegExp),
            })
            .describe("One card as a write sends it: a caution names its reason unless the stored card's reason was stripped."),
        )
        .max(spielberichtePatchSpielberichtBodyBerichtKartenMax),
      torschuetzen: zod
        .array(
          zod
            .object({
              eigentor: zod.boolean(),
              minute: zod.string().regex(spielberichtePatchSpielberichtBodyBerichtTorschuetzenItemMinuteRegExp),
              seite: zod.enum(["team1", "team2"]),
              spieler_id: zod.union([
                zod.string().regex(spielberichtePatchSpielberichtBodyBerichtTorschuetzenItemSpielerIdOneRegExp),
                zod.null(),
              ]),
            })
            .describe(
              "One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.",
            ),
        )
        .max(spielberichtePatchSpielberichtBodyBerichtTorschuetzenMax),
    }),
    bericht_stand: zod.union([zod.int(), zod.null()]),
  })
  .describe("The whole `bericht` block, written wholesale by the referee's PUT and the administrator's PATCH alike.");

/**
 * One fixture's report as the editor's panel reads it, whole, with the state it reads in.
 *
 * Beside it the fixture and the pupils the report names, by name. Both clubs' live squads of the season only with
 * `kader`, which the correction's form picks from: the panel reads no pupil the report does not name, so a fixture
 * holding no report serves none. The report and its state are null where no report stands; `DB-COMMON-001` only for
 * a fixture that does not exist.
 * @summary One fixture's report, whole, for an administrator
 */
export const spielberichteGetSpielberichtAdminPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichteGetSpielberichtAdminParams = zod.object({
  spiel_id: zod.string().regex(spielberichteGetSpielberichtAdminPathSpielIdRegExp),
});

export const spielberichteGetSpielberichtAdminQueryKaderDefault = false;

export const SpielberichteGetSpielberichtAdminQueryParams = zod.object({
  kader: zod
    .boolean()
    .default(spielberichteGetSpielberichtAdminQueryKaderDefault)
    .describe("Serve both clubs' live squads of the season, for a form picking from them"),
});

/**
 * What the booked referee's report form reads.
 *
 * The fixture, both clubs' live squads of the season, the pupils the stored report names outside them, and the stored
 * report, its remarks and card reasons included, or null.
 *
 * Served for a fixture still to come or called off too, whose page says why it takes no report, with both squads
 * empty: the pupils the stored report names are then all in `genannt`. Once the fixture's season has ended,
 * `abgeschlossen` is true and the read is the report alone, both squads empty, which its referee writes no more.
 * Refused
 * `REQ-FUNKTION-001` where the address holds no confirmed, live referee record, and `REQ-BERICHT-002` where the fixture
 * is booked to none of its records; `DB-COMMON-001` for a fixture that does not exist.
 * @summary One fixture's report as its referee reads it
 */
export const spielberichteGetSpielberichtBerichtPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichteGetSpielberichtBerichtParams = zod.object({
  spiel_id: zod.string().regex(spielberichteGetSpielberichtBerichtPathSpielIdRegExp),
});

/**
 * Write the whole report of one fixture as its booked referee, replacing what stood.
 *
 * The proposed result, the scorers, the cards and the remarks. The first write creates it and answers 201; every
 * write changing it raises its `version`, so a report the administrator adopted reads `abweichend` again until it
 * is adopted anew, and a write changing nothing writes nothing. Every write stamps the clubs the fixture fields now,
 * so a report a knockout correction re-fielded a side under reads `teams_geaendert` until it is written again. Writes
 * no fixture: the result is the administrator's to save.
 *
 * `bericht_stand` is the `version` of the report the form was served, null where none stood: a write composed on
 * another version would replace a report its sender never saw.
 *
 * Refuses, in this order, each writing nothing: a write past the person's ceiling for the German day
 * (`REQ-DROSSELUNG-001`); an address holding no confirmed, live referee record (`REQ-FUNKTION-001`); a fixture that
 * does not exist (`DB-COMMON-001`); one booked to none of its records (`REQ-BERICHT-002`); one whose season has
 * ended, whose report its referee only reads (`REQ-BERICHT-007`); a `bericht_stand` other than the version standing
 * now, or than none where none stands (`REQ-BERICHT-006`); one undated or whose day is still to come
 * (`REQ-BERICHT-001`); one called off or struck out (`REQ-BERICHT-004`); a shoot-out proposed on a group-phase fixture
 * (`REQ-BERICHT-009`); a pupil the write newly names on a side outside that side's live squad of the season, a pupil
 * the report already named on that side staying while the side fields the club it did (`REQ-BERICHT-003`); a yellow
 * or second yellow card naming no reason (`REQ-BERICHT-008`); and remarks naming a seat holder of either club, the
 * booked referee or a pupil of either squad (`REQ-BERICHT-005`), last. Every refusal but the ceiling's and
 * `REQ-BERICHT-006` is asked again outside the transaction just before answering, the referee's records included, so
 * a write landing on what was judged before that second asking refuses the report rather than letting it stand, and
 * one landing after it stands beside the report; a write of the report itself landing mid-press conflicts with this
 * one, whose retry meets `REQ-BERICHT-006`. Two first writes at once are two forms opened on no report: the later is
 * refused.
 * @summary Write one fixture's report as its referee
 */
export const spielberichtePutSpielberichtBerichtPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichtePutSpielberichtBerichtParams = zod.object({
  spiel_id: zod.string().regex(spielberichtePutSpielberichtBerichtPathSpielIdRegExp),
});

export const spielberichtePutSpielberichtBerichtBodyBerichtBemerkungenOneMax = 2000;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam1Min = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam2Min = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagTeam1ToreOneMin = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagTeam2ToreOneMin = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtKartenItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePutSpielberichtBerichtBodyBerichtKartenItemSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePutSpielberichtBerichtBodyBerichtKartenMax = 60;

export const spielberichtePutSpielberichtBerichtBodyBerichtTorschuetzenItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePutSpielberichtBerichtBodyBerichtTorschuetzenItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePutSpielberichtBerichtBodyBerichtTorschuetzenMax = 60;

export const SpielberichtePutSpielberichtBerichtBody = zod
  .object({
    bericht: zod.object({
      bemerkungen: zod.union([zod.string().min(1).max(spielberichtePutSpielberichtBerichtBodyBerichtBemerkungenOneMax), zod.null()]),
      ergebnis_vorschlag: zod
        .object({
          elfmeterschiessen: zod.union([
            zod
              .object({
                team1: zod.int().min(spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam1Min),
                team2: zod.int().min(spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam2Min),
              })
              .describe("The penalty shoot-out that settled a level knockout fixture: the side with more goals in it won."),
            zod.null(),
          ]),
          sonderereignis: zod.union([zod.enum(["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"]), zod.null()]),
          team1_tore: zod.union([zod.int().min(spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagTeam1ToreOneMin), zod.null()]),
          team2_tore: zod.union([zod.int().min(spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagTeam2ToreOneMin), zod.null()]),
        })
        .describe(
          "The referee's proposed result, which only the administrator's own save applies.\n\nBoth counts null on a no-show alone: the save composes its goals from the season's forfeit, which typed goals\ncould never equal.",
        ),
      karten: zod
        .array(
          zod
            .object({
              farbe: zod.enum(["gelb", "gelb_rot", "rot"]),
              grund: zod.union([
                zod.enum([
                  "foulspiel",
                  "unsportlichkeit",
                  "handspiel",
                  "meckern",
                  "spielverzoegerung",
                  "wiederholtes_foulspiel",
                  "grobes_foulspiel",
                  "taetlichkeit",
                  "beleidigung",
                  "notbremse",
                ]),
                zod.null(),
              ]),
              minute: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtKartenItemMinuteRegExp),
              seite: zod.enum(["team1", "team2"]),
              spieler_id: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtKartenItemSpielerIdRegExp),
            })
            .describe("One card as a write sends it: a caution names its reason unless the stored card's reason was stripped."),
        )
        .max(spielberichtePutSpielberichtBerichtBodyBerichtKartenMax),
      torschuetzen: zod
        .array(
          zod
            .object({
              eigentor: zod.boolean(),
              minute: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtTorschuetzenItemMinuteRegExp),
              seite: zod.enum(["team1", "team2"]),
              spieler_id: zod.union([
                zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtTorschuetzenItemSpielerIdOneRegExp),
                zod.null(),
              ]),
            })
            .describe(
              "One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.",
            ),
        )
        .max(spielberichtePutSpielberichtBerichtBodyBerichtTorschuetzenMax),
    }),
    bericht_stand: zod.union([zod.int(), zod.null()]),
  })
  .describe("The whole `bericht` block, written wholesale by the referee's PUT and the administrator's PATCH alike.");

/**
 * Every confirmation row of the season, or of its one fixture, and the day the confirmation pass last ran over it.
 *
 * Newest first, closed rows included. No seat's link hashes and no answer's holder digest are served. Every row still
 * holding its party's question is served; `limit` cuts the others, and `vollstaendig` is false where it left the
 * oldest of them out. A season no document has answers no rows and a null day rather than 404.
 * @summary A season's fixture confirmations, or one fixture's
 */
export const spielbestaetigungenGetSpielbestaetigungenQuerySpielIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielbestaetigungenGetSpielbestaetigungenQueryLimitDefault = 1024;
export const spielbestaetigungenGetSpielbestaetigungenQueryLimitMax = 1024;

export const SpielbestaetigungenGetSpielbestaetigungenQueryParams = zod.object({
  saison_id: zod.string(),
  spiel_id: zod.union([zod.string().regex(spielbestaetigungenGetSpielbestaetigungenQuerySpielIdOneRegExp), zod.null()]).optional(),
  limit: zod
    .int()
    .min(1)
    .max(spielbestaetigungenGetSpielbestaetigungenQueryLimitMax)
    .default(spielbestaetigungenGetSpielbestaetigungenQueryLimitDefault),
});

/**
 * Record one club's answer about one Ansetzung, from whichever of its three seats presses first, and the seat it came from.
 *
 * The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
 * (`REQ-ANSETZUNG-002`). Writes no fixture: a proposal is the administrator's to act on.
 *
 * Refuses, in this order: a token no seat holds (`REQ-ANSETZUNG-001`); a link whose seat's address the ban list holds
 * now, whenever it was minted (`REQ-ANSETZUNG-011`); a row already answered, closed since or not
 * (`REQ-ANSETZUNG-002`); one closed unanswered (`REQ-ANSETZUNG-009`); a fixture decided, called off or left by a club
 * (`REQ-ANSETZUNG-005`), then one whose date, time, ground or sides moved since the link (`REQ-ANSETZUNG-004`), each
 * as the confirmation pass's close judges the row; an answer after the deadline's day (`REQ-ANSETZUNG-003`); a
 * proposal dated before today (`REQ-ANSETZUNG-007`); and a proposal the administrator's own save of that date would be
 * refused, judged on what it newly claims and in that save's order: on or after a club's exit
 * (`REQ-ELIGIBILITY-001`), outside the matchday (`REQ-DATE-001`), or within four hours of the ground's or the referee's
 * other fixture (`REQ-CLASH-001`). The reason is stored as typed. Every refusal after the ban's is asked again outside
 * the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
 * than letting it stand.
 * @summary Confirm a fixture's Ansetzung, or decline it proposing another date
 */
export const spielbestaetigungenPostSpielbestaetigungBodyBegruendungOneMax = 500;

export const spielbestaetigungenPostSpielbestaetigungBodyBegruendungOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const spielbestaetigungenPostSpielbestaetigungBodyTokenMax = 128;

export const spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneDatumRegExp = new RegExp(
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
);
export const spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneUhrzeitRegExp = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$");

export const SpielbestaetigungenPostSpielbestaetigungBody = zod
  .object({
    antwort: zod.enum(["zugesagt", "abgelehnt"]),
    begruendung: zod.union([
      zod
        .string()
        .min(1)
        .max(spielbestaetigungenPostSpielbestaetigungBodyBegruendungOneMax)
        .regex(spielbestaetigungenPostSpielbestaetigungBodyBegruendungOneRegExp),
      zod.null(),
    ]),
    token: zod.string().min(1).max(spielbestaetigungenPostSpielbestaetigungBodyTokenMax),
    vorschlag: zod.union([
      zod.object({
        datum: zod.string().regex(spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneDatumRegExp),
        uhrzeit: zod.string().regex(spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneUhrzeitRegExp),
      }),
      zod.null(),
    ]),
  })
  .describe("One club's answer about one Ansetzung, from whichever of its seats pressed first.");

/**
 * Answer what the page renders for the fixture this token asks a club about, and nobody's name or address (`READ-ANSETZUNG-001`).
 *
 * The state, which side the reader's club plays, the fixture as it stands now (or, where it moved since the link, the
 * Ansetzung the link asked about), the row's deadline, the other club's proposal and which role answered. A POST that
 * reads, so the token travels in a body and never in a second URL. Refuses only a token no seat of any row holds
 * (`REQ-ANSETZUNG-001`), a guess and a link voided when its seat changed hands alike: an answered, closed, moved,
 * decided or expired link is SERVED in that state rather than refused, so a reopened link shows what became of it. The
 * state is `gesperrt`, ahead of every other, wherever the ban list holds the address the seat's links were mailed to.
 * `vorschlag` is the state of an open link while the other club's decline proposes another date for the same
 * Ansetzung, whose date and hour alone are served.
 * @summary What one fixture confirmation link opens
 */
export const spielbestaetigungenGetSpielbestaetigungAnsichtBodyTokenMax = 128;

export const SpielbestaetigungenGetSpielbestaetigungAnsichtBody = zod
  .object({
    token: zod.string().min(1).max(spielbestaetigungenGetSpielbestaetigungAnsichtBodyTokenMax),
  })
  .describe("A POST that reads: the token travels in a body, never in a second URL.");

/**
 * Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what the caller must mail.
 *
 * The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
 * to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
 * those, a row whose fixture's day is before today closes `spiel_vergangen`, so nobody is asked about a past date. A
 * club's decline closed `verworfen` is closed again for each of those but a move and a referee change, in the pass
 * that closes an agreement beside it, and once the day it was about has passed: the public fixture then stops
 * counting it as that club's agreement.
 *
 * A closing owes its party a notice where the party's first request or Einteilung went out, about a day today or later:
 * for a move, the slot it left or the one the fixture holds now; for a referee taken off the fixture -- ahead of a move
 * it shares a close with, and never for the referee's own decline, which closed its row as it was given -- and for a
 * call-off, the slot the row was about. The closed row holds the
 * notice, and the notice step answers a share of those the season's rows hold, each built off the fixture and the
 * mailboxes or address as they stand: a team's move in `neue_ansetzungen`, a referee's in
 * `schiedsrichter_neue_ansetzungen`, a referee taken off in `schiedsrichter_gewechselt`, a call-off in `spiel_abgesagt`
 * and `schiedsrichter_spiel_abgesagt`, and the notice an administrator's discard holds, that the date stands, in
 * `vorschlag_verworfen`. A notice is answered on every pass until the caller stamps it through
 * `/mitgeteilt`; one answered as often as `app/api/spielbestaetigungen/services.py :: MITTEILUNG_VERSUCHE_HOECHSTENS`
 * allows, or about no day still to come, is given up: answered in `mitteilungen_aufgegeben` by its row, its fixture
 * and its party's kind, never a person, for the administrator to tell by hand, and answered so on every pass until
 * `/mitgeteilt` stamps it too, so a lost answer loses no give-up. One with nobody left to tell, or whose closing the
 * fixture has since undone -- reinstated, its referee booked again, back at the row's slot -- is dropped unanswered,
 * the mint asking its party afresh.
 *
 * The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
 * ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
 * its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `verworfen`: a
 * decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
 * referee's ghost gets no referee row, the ghost holding no address. The deadline falls the notice period
 * (`app/shared/schemas/bounds.py :: SPIEL_BESTAETIGUNG_FRIST_TAGE`) before the fixture, or today where that has passed.
 * Each seat holding an address gets one link, a person holding two seats one link naming both, and the raw tokens are
 * answered in `anfragen` UNSTAMPED: the caller stamps what it mailed through `/angefragt`, so a request that never went
 * out shows as never asked. An open row's occupied seat holding no link -- its holder replaced,
 * newly seated, or a ban since lifted -- is minted one too and answered the same way. Referee rows are answered in
 * `einteilungen`, with the referee's address and no token. A fixture holding rows about an Ansetzung it has left is asked
 * once the close has shut them and each one's notice that its links are void is answered, in this answer or an earlier
 * one, so that notice goes out first.
 *
 * The reminder mints a fresh link per seat on each team row whose deadline lies a reminder's count of days away
 * (`app/shared/schemas/bounds.py :: SPIEL_ERINNERUNG_TAGE_ERSTE`, `:: SPIEL_ERINNERUNG_TAGE_ZWEITE`), appended beside the
 * links already mailed so every one of them answers until the deadline, and stamps the day BEFORE answering: a failed send
 * costs one reminder, never a daily repeat. It passes over each seat whose last mail the provider refused, and reminds no
 * row this pass inserted nor one whose request was stamped today; where this pass's mint gave one of a row's seats a fresh
 * link, that request is the seat's message of the day and the row's other seats are reminded beside it.
 *
 * A row whose first request was never stamped as sent, inserted on an earlier pass, is asked again on every pass until a
 * stamp lands or it stops taking an answer, a team row after its deadline and a referee row after the fixture's day: a
 * team row in `anfragen`, with a fresh link per seat appended the same way and each
 * refused seat passed over; a referee row in `einteilungen`, unless the provider refused the last mail recorded to the
 * referee's address. A row with nobody left to ask is not asked and stays unstamped, so it shows as never asked.
 *
 * A seat whose address the ban list holds is minted nothing and has nothing written, so it stays due and a later pass mints
 * it once the ban is lifted; each pass logs how many seats it withheld, never which.
 *
 * Each step takes a bounded share and leaves the rest due. Everything answered was committed, and once a step has
 * committed something owed a message, a later failure -- the stamp of the pass's day on this season included -- is logged
 * and the call answers what committed. A row whose write or answer fails is passed over alone, logged by id and counted in
 * `fehlgeschlagen`.
 *
 * A season that is not `active` is passed by whole -- nothing closed, minted, reminded or stamped, every list empty -- so a
 * mistyped call, or one for a season ended since the listing, mails nobody. 404 where no season has the id.
 * @summary Run one season's fixture confirmation pass
 */
export const SpielbestaetigungenSweepSpielbestaetigungenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Record that the first message about the rows named went out, team and referee rows alike.
 *
 * Every named row of this season not yet stamped is stamped today, answered or closed since or not: the stamp says the
 * request was mailed, which a row closed for a move needs before its parties are told the date changed. A row already
 * stamped keeps the day it has, and an id of another season is skipped. A row whose stamp fails is passed over alone,
 * logged by id, left unstamped and counted in `fehlgeschlagen`. 404 where no season has the id. An empty list answers zero.
 * @summary Stamp the confirmations whose first message went out
 */
export const SpielbestaetigungenAngefragtSpielbestaetigungenParams = zod.object({
  saison_id: zod.string(),
});

export const spielbestaetigungenAngefragtSpielbestaetigungenBodySpielbestaetigungIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielbestaetigungenAngefragtSpielbestaetigungenBodySpielbestaetigungIdsMax = 83;

export const SpielbestaetigungenAngefragtSpielbestaetigungenBody = zod
  .object({
    spielbestaetigung_ids: zod
      .array(zod.string().regex(spielbestaetigungenAngefragtSpielbestaetigungenBodySpielbestaetigungIdsItemRegExp))
      .max(spielbestaetigungenAngefragtSpielbestaetigungenBodySpielbestaetigungIdsMax),
  })
  .describe("Which rows' first messages went. Stamped whether or not answered or closed since: the stamp records the send.");

/**
 * Record that the notices about the rows named went out, or were given up and logged, so no later pass answers them again.
 *
 * Every named row of this season still holding its notice stops holding it. A row holding none -- stamped already,
 * dropped, or never owing one -- and an id of another season are left alone and not counted. No claim is checked:
 * one process runs the pass, so no second pass can hold the rows named. One
 * transaction, recorded under the system actor. 404 where no season has the id. An empty list answers zero.
 * @summary Stamp the confirmations whose notice went out
 */
export const SpielbestaetigungenMitgeteiltSpielbestaetigungenParams = zod.object({
  saison_id: zod.string(),
});

export const spielbestaetigungenMitgeteiltSpielbestaetigungenBodySpielbestaetigungIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielbestaetigungenMitgeteiltSpielbestaetigungenBodySpielbestaetigungIdsMax = 25;

export const SpielbestaetigungenMitgeteiltSpielbestaetigungenBody = zod
  .object({
    spielbestaetigung_ids: zod
      .array(zod.string().regex(spielbestaetigungenMitgeteiltSpielbestaetigungenBodySpielbestaetigungIdsItemRegExp))
      .max(spielbestaetigungenMitgeteiltSpielbestaetigungenBodySpielbestaetigungIdsMax),
  })
  .describe("Which rows' notices went, or were given up: each stops being owed, so no later pass answers it again.");

/**
 * Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.
 *
 * The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
 * null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
 * booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
 * the season's end. Answering is open until the fixture's day, whatever deadline a club's row of the same fixture
 * carries.
 *
 * Refuses, in this order: an answer past the person's ceiling for the German day (`REQ-DROSSELUNG-001`); an address
 * holding no live, confirmed referee record (`REQ-FUNKTION-001`); an id naming no row of an `active` season, or a row
 * naming none of those records (`REQ-ANSETZUNG-015`, one answer for both); a row already answered, by them or by the
 * league for them (`REQ-ANSETZUNG-002`); one closed unanswered (`REQ-ANSETZUNG-009`); a fixture decided, called off
 * or left by a club (`REQ-ANSETZUNG-005`), then one whose date, time, ground or sides moved since the row, or which
 * books another referee or none (`REQ-ANSETZUNG-004`); and a fixture whose day has gone by (`REQ-ANSETZUNG-003`). An
 * acceptance is judged again outside the transaction just before answering, so a move or a reassignment landing
 * mid-answer refuses it rather than letting it stand.
 *
 * **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
 * on the public fixture, and a decline takes it off.
 * @summary Accept or decline one of the signed-in referee's own fixture assignments
 */
export const spielbestaetigungenPostSchiedsrichterAntwortPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenPostSchiedsrichterAntwortParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenPostSchiedsrichterAntwortPathSpielbestaetigungIdRegExp),
});

export const spielbestaetigungenPostSchiedsrichterAntwortBodyBegruendungOneMax = 500;

export const spielbestaetigungenPostSchiedsrichterAntwortBodyBegruendungOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SpielbestaetigungenPostSchiedsrichterAntwortBody = zod
  .object({
    antwort: zod.enum(["zugesagt", "abgelehnt"]),
    begruendung: zod.union([
      zod
        .string()
        .min(1)
        .max(spielbestaetigungenPostSchiedsrichterAntwortBodyBegruendungOneMax)
        .regex(spielbestaetigungenPostSchiedsrichterAntwortBodyBegruendungOneRegExp),
      zod.null(),
    ]),
  })
  .describe("A referee's answer about one row naming them: a decline gives a reason, which the administrator reads.");

/**
 * Record that the party of an open confirmation agreed to its Ansetzung elsewhere than through its link.
 *
 * The administrator's reason says how. IRREVERSIBLE: the answer is the league's record of how a date was agreed, and
 * nothing rewrites it. It names nobody: no seat and no person is recorded, and the reason takes any text and goes at
 * the season's end. Refused for a row
 * already answered, by a seat or by an administrator, or closed (`REQ-ANSETZUNG-013`), including one a seat answers
 * while this request runs: of the two answers exactly one is stored. A row about an Ansetzung the fixture has since
 * left is settled as asked, and the next confirmation pass closes it.
 * @summary Record a party's Zusage on its behalf
 */
export const spielbestaetigungenEintragenSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenEintragenSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenEintragenSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

export const spielbestaetigungenEintragenSpielbestaetigungBodyBegruendungMax = 500;

export const spielbestaetigungenEintragenSpielbestaetigungBodyBegruendungRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SpielbestaetigungenEintragenSpielbestaetigungBody = zod
  .object({
    begruendung: zod
      .string()
      .min(1)
      .max(spielbestaetigungenEintragenSpielbestaetigungBodyBegruendungMax)
      .regex(spielbestaetigungenEintragenSpielbestaetigungBodyBegruendungRegExp),
  })
  .describe(
    "The administrator's Zusage for a party that answered elsewhere, and how it was given.\n\nNo way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.",
  );

/**
 * Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.
 *
 * IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `verworfen`, which is that club's one
 * answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
 * counts it as the club's agreement, the league having kept the date, until a pass closes it again as it closes an
 * agreement beside it. Where its day is still to come, the row holds the club a notice that the date stands, which
 * the confirmation pass mails. Refused for any other row -- open, agreed, declined without a proposal, a referee's, closed, or
 * about an Ansetzung the fixture has left, the fixture moving while this request runs included (`REQ-ANSETZUNG-014`):
 * the confirmation pass closes that row and tells its club of the move.
 * @summary Discard a club's proposed date
 */
export const spielbestaetigungenVerwerfenSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenVerwerfenSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenVerwerfenSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

/**
 * List the Spiele matching the filters, of the current season unless `saison_id` names another.
 *
 * A season this tier may not read lists nothing; `playoffs` means every phase but `gruppenphase`, and
 * `ausstehend` includes today.
 * @summary List Spiele
 */
export const spieleGetSpieleQueryTeamIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spieleGetSpieleQueryLimitDefault = 1024;
export const spieleGetSpieleQueryLimitMax = 1024;

export const spieleGetSpieleQuerySortByDefault = `datum`;
export const spieleGetSpieleQueryOrderDefault = `asc`;

export const SpieleGetSpieleQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  saison_phase: zod
    .union([zod.literal("playoffs"), zod.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]), zod.null()])
    .optional(),
  spiel_status: zod.union([zod.enum(["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]), zod.null()]).optional(),
  team_id: zod.union([zod.string().regex(spieleGetSpieleQueryTeamIdOneRegExp), zod.null()]).optional(),
  limit: zod.int().min(1).max(spieleGetSpieleQueryLimitMax).default(spieleGetSpieleQueryLimitDefault),
  sort_by: zod.enum(["datum", "uhrzeit", "spiel_nr", "saison_phase"]).default(spieleGetSpieleQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(spieleGetSpieleQueryOrderDefault),
});

/**
 * List one season's Spiele needing the administrator, with the bracket's faults and every report's state.
 *
 * The season is `saison_id`'s, else the active one, answering 404 while none is. A fixture qualifies when it is
 * called off; lacks a date, time, venue or referee; is past without a result; has a knockout side with neither
 * team nor source; holds a report not adopted as it stands; is put before the administrator by a club's
 * unclosed confirmation; or carries a bracket fault, a booking onto a retired venue or referee and a claim within
 * four hours of another fixture's among them.
 * @summary Spiele needing attention
 */
export const SpieleGetSpieleActionRequiredQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
});

/**
 * List Spiele as `GET /spiele` does, a planned season's included, in the admin shape.
 *
 * Each referee carries their whole name, and each booking its money.
 * @summary Spiele for the admin surfaces
 */
export const spieleGetSpieleForAdminQueryTeamIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spieleGetSpieleForAdminQueryLimitDefault = 1024;
export const spieleGetSpieleForAdminQueryLimitMax = 1024;

export const spieleGetSpieleForAdminQuerySortByDefault = `datum`;
export const spieleGetSpieleForAdminQueryOrderDefault = `asc`;

export const SpieleGetSpieleForAdminQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  saison_phase: zod
    .union([zod.literal("playoffs"), zod.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]), zod.null()])
    .optional(),
  spiel_status: zod.union([zod.enum(["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]), zod.null()]).optional(),
  team_id: zod.union([zod.string().regex(spieleGetSpieleForAdminQueryTeamIdOneRegExp), zod.null()]).optional(),
  limit: zod.int().min(1).max(spieleGetSpieleForAdminQueryLimitMax).default(spieleGetSpieleForAdminQueryLimitDefault),
  sort_by: zod.enum(["datum", "uhrzeit", "spiel_nr", "saison_phase"]).default(spieleGetSpieleForAdminQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(spieleGetSpieleForAdminQueryOrderDefault),
});

/**
 * Return one match by its id, answering 404 for a match of a season this tier may not read.
 * @summary One Spiel
 */
export const spieleGetSpielPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieleGetSpielParams = zod.object({
  spiel_id: zod.string().regex(spieleGetSpielPathSpielIdRegExp),
});

/**
 * Save one Spiel wholesale and resolve the season's bracket, answering every fixture the save moved beyond it.
 *
 * Every name is composed by the server. With `uebernimmt_bericht` the save also stamps the fixture's Spielbericht
 * adopted, where it still stands at that version about the clubs the save leaves; a miss refuses nothing. A
 * `dry_run` answers the same report and writes nothing.
 * @summary Update a Spiel
 */
export const spielePatchSpielDataPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielePatchSpielDataParams = zod.object({
  spiel_id: zod.string().regex(spielePatchSpielDataPathSpielIdRegExp),
});

export const spielePatchSpielDataQueryDryRunDefault = false;

export const SpielePatchSpielDataQueryParams = zod.object({
  uebernimmt_bericht: zod
    .union([zod.int().min(1), zod.null()])
    .optional()
    .describe("The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted"),
  dry_run: zod
    .boolean()
    .default(spielePatchSpielDataQueryDryRunDefault)
    .describe("Report what this payload would move and destroy, and write nothing"),
});

export const spielePatchSpielDataBodyDatumOneRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spielePatchSpielDataBodyDatumThreeRegExp = new RegExp("^\\s*$");
export const spielePatchSpielDataBodyElfmeterschiessenOneTeam1Min = 0;

export const spielePatchSpielDataBodyElfmeterschiessenOneTeam2Min = 0;

export const spielePatchSpielDataBodyNotizOneMax = 4096;

export const spielePatchSpielDataBodyOrtOneMietpreisMin = 0;

export const spielePatchSpielDataBodyOrtOneSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielDataBodySchiedsrichterOnePaymentMin = 0;

export const spielePatchSpielDataBodySchiedsrichterOneSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielDataBodySchiedsrichterStandOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielDataBodyTeam1OneTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielDataBodyTeam1OneToreOneMin = 0;

export const spielePatchSpielDataBodyTeam1QuelleOneOnePlatzExclusiveMin = 0;

export const spielePatchSpielDataBodyTeam1QuelleOneTwoSpielNrExclusiveMin = 0;

export const spielePatchSpielDataBodyTeam2OneTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielDataBodyTeam2OneToreOneMin = 0;

export const spielePatchSpielDataBodyTeam2QuelleOneOnePlatzExclusiveMin = 0;

export const spielePatchSpielDataBodyTeam2QuelleOneTwoSpielNrExclusiveMin = 0;

export const spielePatchSpielDataBodyUhrzeitOneRegExp = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$");
export const spielePatchSpielDataBodyUhrzeitThreeRegExp = new RegExp("^\\s*$");

export const SpielePatchSpielDataBody = zod.object({
  datum: zod.union([
    zod.string().regex(spielePatchSpielDataBodyDatumOneRegExp),
    zod.null(),
    zod.string().regex(spielePatchSpielDataBodyDatumThreeRegExp),
  ]),
  elfmeterschiessen: zod.union([
    zod
      .object({
        team1: zod.int().min(spielePatchSpielDataBodyElfmeterschiessenOneTeam1Min),
        team2: zod.int().min(spielePatchSpielDataBodyElfmeterschiessenOneTeam2Min),
      })
      .describe("The penalty shoot-out that settled a level knockout fixture: the side with more goals in it won."),
    zod.null(),
  ]),
  notiz: zod.union([zod.string().max(spielePatchSpielDataBodyNotizOneMax), zod.null()]),
  ort: zod.union([
    zod
      .object({
        mietpreis: zod.int().min(spielePatchSpielDataBodyOrtOneMietpreisMin),
        spielort_id: zod.string().regex(spielePatchSpielDataBodyOrtOneSpielortIdRegExp),
      })
      .describe("The venue as the save sends it: which ground, and what this fixture pays for it."),
    zod.null(),
  ]),
  schiedsrichter: zod.union([
    zod
      .object({
        payment: zod.int().min(spielePatchSpielDataBodySchiedsrichterOnePaymentMin),
        schiedsrichter_id: zod.string().regex(spielePatchSpielDataBodySchiedsrichterOneSchiedsrichterIdRegExp),
      })
      .describe("The referee as the save sends it: who, and what this fixture pays them."),
    zod.null(),
  ]),
  schiedsrichter_stand: zod.union([zod.string().regex(spielePatchSpielDataBodySchiedsrichterStandOneRegExp), zod.null()]),
  sonderereignis: zod.union([zod.enum(["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"]), zod.null()]),
  team1: zod.union([
    zod
      .object({
        team_id: zod.string().regex(spielePatchSpielDataBodyTeam1OneTeamIdRegExp),
        tore: zod.union([zod.int().min(spielePatchSpielDataBodyTeam1OneToreOneMin), zod.null()]),
      })
      .describe(
        "One side of a fixture as the save sends it: the team and its goals.\n\nThe server composes the name and shorthand from the season's team row and ignores a copy sent.",
      ),
    zod.null(),
  ]),
  team1_quelle: zod.union([
    zod.union([
      zod
        .object({
          gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
          platz: zod.int().gt(spielePatchSpielDataBodyTeam1QuelleOneOnePlatzExclusiveMin),
          type: zod.literal("gruppe").meta({ title: "Type" }),
        })
        .describe("A slot fed by the group phase: the team finishing `platz` in `gruppe`."),
      zod
        .object({
          ausgang: zod.enum(["sieger", "verlierer"]),
          spiel_nr: zod.int().gt(spielePatchSpielDataBodyTeam1QuelleOneTwoSpielNrExclusiveMin),
          type: zod.literal("spiel").meta({ title: "Type" }),
        })
        .describe("A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."),
    ]),
    zod.null(),
  ]),
  team2: zod.union([
    zod
      .object({
        team_id: zod.string().regex(spielePatchSpielDataBodyTeam2OneTeamIdRegExp),
        tore: zod.union([zod.int().min(spielePatchSpielDataBodyTeam2OneToreOneMin), zod.null()]),
      })
      .describe(
        "One side of a fixture as the save sends it: the team and its goals.\n\nThe server composes the name and shorthand from the season's team row and ignores a copy sent.",
      ),
    zod.null(),
  ]),
  team2_quelle: zod.union([
    zod.union([
      zod
        .object({
          gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
          platz: zod.int().gt(spielePatchSpielDataBodyTeam2QuelleOneOnePlatzExclusiveMin),
          type: zod.literal("gruppe").meta({ title: "Type" }),
        })
        .describe("A slot fed by the group phase: the team finishing `platz` in `gruppe`."),
      zod
        .object({
          ausgang: zod.enum(["sieger", "verlierer"]),
          spiel_nr: zod.int().gt(spielePatchSpielDataBodyTeam2QuelleOneTwoSpielNrExclusiveMin),
          type: zod.literal("spiel").meta({ title: "Type" }),
        })
        .describe("A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."),
    ]),
    zod.null(),
  ]),
  uhrzeit: zod.union([
    zod.string().regex(spielePatchSpielDataBodyUhrzeitOneRegExp),
    zod.null(),
    zod.string().regex(spielePatchSpielDataBodyUhrzeitThreeRegExp),
  ]),
});

/**
 * Return one match in the admin shape, money included, for the editor.
 * @summary One Spiel for the admin editor
 */
export const spieleGetSpielForAdminPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieleGetSpielForAdminParams = zod.object({
  spiel_id: zod.string().regex(spieleGetSpielForAdminPathSpielIdRegExp),
});

/**
 * List players, normally one team's squad in one season.
 *
 * Naming a `team_id` without a `saison_id` returns that team's squad in the CURRENT season, and 404s
 * while no season is active. Naming neither lists every season's players, a season this tier may not
 * read adding no row. BASE TIER: a pupil reads back redacted (`READ-PUPIL-001`).
 *
 * Both names are `null` where the person's consent record does not publish them (`READ-PUPIL-003`);
 * the row keeps its `nummer` and `position`, and no row carries the person's record id
 * (`READ-PUPIL-005`).
 * @summary List Spieler
 */
export const spielerGetSpielerQueryTeamIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielerGetSpielerQueryLimitDefault = 1024;
export const spielerGetSpielerQueryLimitMax = 1024;

export const spielerGetSpielerQuerySortByDefault = `position`;
export const spielerGetSpielerQueryOrderDefault = `asc`;

export const SpielerGetSpielerQueryParams = zod.object({
  team_id: zod.union([zod.string().regex(spielerGetSpielerQueryTeamIdOneRegExp), zod.null()]).optional(),
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  limit: zod.int().min(1).max(spielerGetSpielerQueryLimitMax).default(spielerGetSpielerQueryLimitDefault),
  sort_by: zod.enum(["vorname", "nummer", "position"]).default(spielerGetSpielerQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(spielerGetSpielerQueryOrderDefault),
});

/**
 * The squad of one team in one season, for a person holding any contact seat on it.
 *
 * Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
 * e-mail address or telephone number of anybody. `nummer_doppelt` marks a live row whose number
 * another live row of the squad wears, compared as stored. `erlaubte_stufen` is what the season's
 * rules offer an edit. Refused `REQ-FUNKTION-001` where the signed-in person holds no seat on this
 * team in this season, a seat on a `past` season holding none.
 * @summary Read a team's squad as its seat holder
 */
export const spielerGetKaderPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerGetKaderParams = zod.object({
  team_id: zod.string().regex(spielerGetKaderPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Take a player out of this team's squad for the season, as any contact seat of the team may. SOFT: the row stays.
 *
 * Stamps the row's `inactive_since`; the person stays in the league, and only an administrator
 * brings the row back. 404 where this team holds no live row for the player in this season,
 * another team's pupil and an ausgetragen row alike. Refused `REQ-DROSSELUNG-001` past the person's ceiling for the
 * German day, ahead of the 404, and `REQ-FUNKTION-001` without a seat.
 * @summary Take a Spieler out of the squad as its team's seat holder (austragen)
 */
export const spielerDeleteKaderZeilePathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielerDeleteKaderZeilePathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerDeleteKaderZeileParams = zod.object({
  team_id: zod.string().regex(spielerDeleteKaderZeilePathTeamIdRegExp),
  saison_id: zod.string(),
  spieler_id: zod.string().regex(spielerDeleteKaderZeilePathSpielerIdRegExp),
});

/**
 * Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.
 *
 * The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
 * row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
 * nothing is written. Refused `REQ-DROSSELUNG-001` past the person's ceiling for the German day, ahead of the 404 and
 * every rule, `REQ-FUNKTION-001` without a seat, `REQ-SQUAD-005` for a `stufe` the
 * season's `erlaubte_stufen` does not offer unless the row already holds it, and `REQ-SQUAD-004`
 * for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
 * @summary Update a squad entry as its team's seat holder
 */
export const spielerPatchKaderZeilePathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielerPatchKaderZeilePathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPatchKaderZeileParams = zod.object({
  team_id: zod.string().regex(spielerPatchKaderZeilePathTeamIdRegExp),
  saison_id: zod.string(),
  spieler_id: zod.string().regex(spielerPatchKaderZeilePathSpielerIdRegExp),
});

export const spielerPatchKaderZeileBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");

export const SpielerPatchKaderZeileBody = zod
  .object({
    nummer: zod.union([zod.string().regex(spielerPatchKaderZeileBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    rolle: zod.union([zod.enum(["kapitaen", "co_kapitaen"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
  })
  .describe(
    "What a team's seat holder may change on a live squad row, WHOLESALE for `FLPatchSpielerPayload`'s reason.\n\nNever `_SaisonSpielerPayload`'s child, which carries `team_id`: a representative moves no pupil\nto another team, and `extra=\"forbid\"` refuses that key.",
  );

/**
 * Whether a player entered into this season's squads today would be marked a Nachnominierung.
 *
 * `POST /spieler/{spieler_id}/saisons` derives the stored marker from this same test: from the first
 * day of matchday 1 of the season's first phase. A season whose matchday 1 is undated, or which
 * holds none yet, answers `false`. 404 where no season has this id.
 * @summary Whether a squad entry into a season today is a Nachnominierung
 */
export const SpielerGetSpielerNachnominierungParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.
 *
 * Writes those two on this one record, each moved choice with its evidence (`nachweis.<choice>`), and nothing else:
 * the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
 * PATCH moving neither choice writes nothing. A GRANT (`umfang` to `kader_oeffentlich` or `medien` to `true`) is
 * taken on a live record alone; a withdrawal on a retired one too.
 *
 * Refuses, in this order: an address holding no confirmed pupil record (`REQ-FUNKTION-001`); a `nachweis_stand`
 * other than the record's own, either choice having moved since the page was served (`REQ-EINWILLIGUNG-003`); a
 * grant on a retired record (`REQ-EINWILLIGUNG-004`); a `text_version` naming no version of the account page's pupil
 * control, or a grant naming any but the page's running one (`REQ-EINWILLIGUNG-001`); `medien` moving to `true` where
 * the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`); and a
 * grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), which counts grants alone, so a
 * withdrawal is never refused for it. Each refusal writes nothing.
 *
 * **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
 * name is served, and nothing here can.
 * @summary Change a signed-in pupil's own publication and media consent
 */
export const spielerPatchEinwilligungBodyTextVersionMax = 64;

export const SpielerPatchEinwilligungBody = zod.object({
  medien: zod.boolean(),
  nachweis_stand: zod.object({
    medien: zod.union([zod.string(), zod.null()]),
    umfang: zod.union([zod.string(), zod.null()]),
  }),
  text_version: zod.string().min(1).max(spielerPatchEinwilligungBodyTextVersionMax),
  umfang: zod.enum(["kader_oeffentlich", "intern"]),
});

/**
 * Retire a player. SOFT: it stamps `inactive_since`, and their squad rows are LEFT ALONE.
 * @summary Retire a Spieler (soft delete)
 */
export const spielerDeleteSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerDeleteSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerDeleteSpielerPathSpielerIdRegExp),
});

/**
 * Return one player -- an id, a forename and an INITIAL, which is all this surface needs.
 *
 * Both names are `null` where the person's consent record does not publish them (`READ-PUPIL-003`).
 *
 * NOT the flattened squad shape the list returns: those are season-scoped, and picking a season
 * here would make the answer depend on a default nobody asked for.
 * @summary One Spieler
 */
export const spielerGetSpielerByIdPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerGetSpielerByIdParams = zod.object({
  spieler_id: zod.string().regex(spielerGetSpielerByIdPathSpielerIdRegExp),
});

/**
 * Replace a player's own facts wholesale. No fan-out: unlike a team or a venue, a person is embedded in no other document.
 * @summary Update a Spieler's name
 */
export const spielerPatchSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPatchSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerPatchSpielerPathSpielerIdRegExp),
});

export const spielerPatchSpielerBodyGeburtsdatumRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spielerPatchSpielerBodyNachnameOneMax = 80;

export const spielerPatchSpielerBodyNachnameOneRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const spielerPatchSpielerBodyVornameMax = 80;

export const spielerPatchSpielerBodyVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");

export const SpielerPatchSpielerBody = zod
  .object({
    geburtsdatum: zod.string().regex(spielerPatchSpielerBodyGeburtsdatumRegExp),
    nachname: zod.union([
      zod.string().min(1).max(spielerPatchSpielerBodyNachnameOneMax).regex(spielerPatchSpielerBodyNachnameOneRegExp),
      zod.null(),
    ]),
    vorname: zod.string().min(1).max(spielerPatchSpielerBodyVornameMax).regex(spielerPatchSpielerBodyVornameRegExp),
  })
  .describe(
    "Replaces the person's names WHOLESALE.\n\nThe handler `$set`s this model's dump, so a field with a default would let a form that forgot it\nwrite that default over a stored value.",
  );

/**
 * Clear `inactive_since`: the PERSON is back in the league. A squad row they left is revived by its own reactivate.
 * @summary Bring a retired Spieler back
 */
export const spielerReactivateSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerReactivateSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerReactivateSpielerPathSpielerIdRegExp),
});

/**
 * Put a player in a team's squad for a season.
 *
 * 404 where no player has this id. One row per player per season: moving a player is a PATCH of
 * `team_id`, and a repeat is a 409 even where the row is retired. A
 * squad holds each `rolle` once (`REQ-SQUAD-004`). `ist_nachnominiert` is derived here and never
 * taken from the body: it is true from the first day of the season's matchday 1, and false while
 * that matchday is undated.
 * @summary Add a Spieler to a squad
 */
export const spielerPostSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPostSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerPostSaisonSpielerPathSpielerIdRegExp),
});

export const spielerPostSaisonSpielerBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");
export const spielerPostSaisonSpielerBodySaisonIdMin = 4;
export const spielerPostSaisonSpielerBodySaisonIdMax = 4;

export const spielerPostSaisonSpielerBodyTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPostSaisonSpielerBody = zod
  .object({
    nummer: zod.union([zod.string().regex(spielerPostSaisonSpielerBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    rolle: zod.union([zod.enum(["kapitaen", "co_kapitaen"]), zod.null()]),
    saison_id: zod.string().min(spielerPostSaisonSpielerBodySaisonIdMin).max(spielerPostSaisonSpielerBodySaisonIdMax),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    team_id: zod.string().regex(spielerPostSaisonSpielerBodyTeamIdRegExp),
  })
  .describe(
    "One player's membership of one team's squad for one season.\n\nEvery field is required, including those a squad often does not know: a caller states `null`\nrather than omitting, so the answer is theirs and not a default nobody chose.",
  );

/**
 * Take a player out of a season's squad. SOFT: the row stays.
 *
 * The row records that this player wore this number in this squad, which stays true after they
 * leave. `GET /spieler/memberships` is where an admin reads it back, marked by `inactive_since`.
 * @summary Remove a Spieler from a squad
 */
export const spielerDeleteSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerDeleteSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerDeleteSaisonSpielerPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * Update a player's squad entry for that season.
 *
 * Changing `team_id` is how a transfer is recorded. A DUPLICATE `nummer` is permitted
 * (`docs/domain.md`'s what the model permits on purpose); a `rolle` another live row holds is not
 * (`REQ-SQUAD-004`).
 * @summary Update a squad entry
 */
export const spielerPatchSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPatchSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerPatchSaisonSpielerPathSpielerIdRegExp),
  saison_id: zod.string(),
});

export const spielerPatchSaisonSpielerBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");
export const spielerPatchSaisonSpielerBodyTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPatchSaisonSpielerBody = zod
  .object({
    nummer: zod.union([zod.string().regex(spielerPatchSaisonSpielerBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    rolle: zod.union([zod.enum(["kapitaen", "co_kapitaen"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    team_id: zod.string().regex(spielerPatchSaisonSpielerBodyTeamIdRegExp),
  })
  .describe(
    "Replaces the squad row WHOLESALE — see `FLPatchSpielerPayload` for why nothing has a default.\n\n`team_id` is editable here: a mid-season transfer is a change to the junction row.",
  );

/**
 * Clear a squad row's `inactive_since`, with the number and position it had.
 *
 * Where a repeat create is redirected: a create reviving the row
 * would overwrite both. Refused where the squad has filled up, where its club left, or where the
 * `rolle` the row carries has been given to somebody else since (`REQ-SQUAD-004`).
 * @summary Put a Spieler back in a squad they left
 */
export const spielerReactivateSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerReactivateSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerReactivateSaisonSpielerPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * An admin-tier read: the rent is money (`READ-MONEY-001`) and the address parts serve no public page (`READ-ADDRESS-001`).
 *
 * Deactivated venues stay retrievable for a historical match. `maps_link` is a Maps search string, not a URL.
 * @summary List Spielorte
 */
export const spielorteGetSpielorteQueryIncludeInactiveDefault = false;
export const spielorteGetSpielorteQueryLimitDefault = 1024;
export const spielorteGetSpielorteQueryLimitMax = 1024;

export const spielorteGetSpielorteQuerySortByDefault = `name`;
export const spielorteGetSpielorteQueryOrderDefault = `asc`;

export const SpielorteGetSpielorteQueryParams = zod.object({
  include_inactive: zod.boolean().default(spielorteGetSpielorteQueryIncludeInactiveDefault),
  limit: zod.int().min(1).max(spielorteGetSpielorteQueryLimitMax).default(spielorteGetSpielorteQueryLimitDefault),
  sort_by: zod.literal("name").default(spielorteGetSpielorteQuerySortByDefault).meta({ title: "Sort By" }),
  order: zod.enum(["asc", "desc"]).default(spielorteGetSpielorteQueryOrderDefault),
});

/**
 * Create a venue. `maps_link` is built server-side from the name and address and must not be submitted.
 * @summary Create a Spielort
 */
export const spielortePostSpielortBodyAddressHausnummerMax = 16;

export const spielortePostSpielortBodyAddressHausnummerRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const spielortePostSpielortBodyAddressPlzRegExp = new RegExp("^[0-9]{5}$");
export const spielortePostSpielortBodyAddressStadtMax = 80;

export const spielortePostSpielortBodyAddressStadtteilMax = 80;

export const spielortePostSpielortBodyAddressStrasseMax = 120;

export const spielortePostSpielortBodyDefaultMietpreisMin = 0;

export const SpielortePostSpielortBody = zod.object({
  address: zod.object({
    hausnummer: zod.string().max(spielortePostSpielortBodyAddressHausnummerMax).regex(spielortePostSpielortBodyAddressHausnummerRegExp),
    plz: zod.string().regex(spielortePostSpielortBodyAddressPlzRegExp),
    stadt: zod.string().min(1).max(spielortePostSpielortBodyAddressStadtMax),
    stadtteil: zod.string().max(spielortePostSpielortBodyAddressStadtteilMax),
    strasse: zod.string().min(1).max(spielortePostSpielortBodyAddressStrasseMax),
  }),
  default_mietpreis: zod.int().min(spielortePostSpielortBodyDefaultMietpreisMin),
  name: zod.string().min(1),
});

/**
 * Deactivate a venue. SOFT: it stamps `inactive_since`, and the document stays.
 *
 * Matches embed a copy, so a hard delete would orphan every historical match that used it. Refused
 * while an unplayed fixture is still booked here (`REQ-RETIRE-003`).
 * @summary Deactivate a Spielort (soft delete)
 */
export const spielorteDeleteSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteDeleteSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteDeleteSpielortPathSpielortIdRegExp),
});

/**
 * Admin-tier as the list is, and for the same two rules (`READ-MONEY-001`, `READ-ADDRESS-001`).
 *
 * Deactivated ones included -- a historical match's venue is the case worth answering.
 * @summary One Spielort
 */
export const spielorteGetSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteGetSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteGetSpielortPathSpielortIdRegExp),
});

/**
 * Update a venue, then update every Spiel that embeds it.
 *
 * The fan-out is not optional: without it, match cards keep showing the old name. `mietpreis` is
 * NOT fanned out -- the rent on a match is what was agreed for that match.
 * @summary Update a Spielort and fan the change out
 */
export const spielortePatchSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielortePatchSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielortePatchSpielortPathSpielortIdRegExp),
});

export const spielortePatchSpielortBodyAddressHausnummerMax = 16;

export const spielortePatchSpielortBodyAddressHausnummerRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const spielortePatchSpielortBodyAddressPlzRegExp = new RegExp("^[0-9]{5}$");
export const spielortePatchSpielortBodyAddressStadtMax = 80;

export const spielortePatchSpielortBodyAddressStadtteilMax = 80;

export const spielortePatchSpielortBodyAddressStrasseMax = 120;

export const spielortePatchSpielortBodyDefaultMietpreisMin = 0;

export const SpielortePatchSpielortBody = zod.object({
  address: zod.object({
    hausnummer: zod.string().max(spielortePatchSpielortBodyAddressHausnummerMax).regex(spielortePatchSpielortBodyAddressHausnummerRegExp),
    plz: zod.string().regex(spielortePatchSpielortBodyAddressPlzRegExp),
    stadt: zod.string().min(1).max(spielortePatchSpielortBodyAddressStadtMax),
    stadtteil: zod.string().max(spielortePatchSpielortBodyAddressStadtteilMax),
    strasse: zod.string().min(1).max(spielortePatchSpielortBodyAddressStrasseMax),
  }),
  default_mietpreis: zod.int().min(spielortePatchSpielortBodyDefaultMietpreisMin),
  name: zod.string().min(1),
});

/**
 * Clear `inactive_since`, putting the venue back into the picker and every default read.
 * @summary Bring a deactivated Spielort back
 */
export const spielorteReactivateSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteReactivateSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteReactivateSpielortPathSpielortIdRegExp),
});

/**
 * List matchdays for a season, in the order they are played.
 *
 * That order is the phase in bracket order, then the stored `position` -- `sort_by=natural`.
 * Omitting `saison_id` returns the CURRENT season; one this tier may not read 404s.
 * @summary List Spieltage
 */
export const spieltageGetSpieltageQueryLimitDefault = 1024;
export const spieltageGetSpieltageQueryLimitMax = 1024;

export const spieltageGetSpieltageQuerySortByDefault = `natural`;
export const spieltageGetSpieltageQueryOrderDefault = `asc`;

export const SpieltageGetSpieltageQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  saison_phase: zod
    .union([zod.literal("playoffs"), zod.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]), zod.null()])
    .optional(),
  limit: zod.int().min(1).max(spieltageGetSpieltageQueryLimitMax).default(spieltageGetSpieltageQueryLimitDefault),
  sort_by: zod.enum(["natural", "beginn", "ende"]).default(spieltageGetSpieltageQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(spieltageGetSpieltageQueryOrderDefault),
});

/**
 * List a season's matchdays for the admin surfaces, a `future` season's included.
 *
 * Same filters, order and shape as `GET /spieltage`, without its season gate: a season's matchdays
 * are drawn while it is planned, and dating them is what this list is for.
 * @summary Spieltage for the admin surfaces
 */
export const spieltageGetSpieltageForAdminQueryLimitDefault = 1024;
export const spieltageGetSpieltageForAdminQueryLimitMax = 1024;

export const spieltageGetSpieltageForAdminQuerySortByDefault = `natural`;
export const spieltageGetSpieltageForAdminQueryOrderDefault = `asc`;

export const SpieltageGetSpieltageForAdminQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  saison_phase: zod
    .union([zod.literal("playoffs"), zod.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]), zod.null()])
    .optional(),
  limit: zod.int().min(1).max(spieltageGetSpieltageForAdminQueryLimitMax).default(spieltageGetSpieltageForAdminQueryLimitDefault),
  sort_by: zod.enum(["natural", "beginn", "ende"]).default(spieltageGetSpieltageForAdminQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(spieltageGetSpieltageForAdminQueryOrderDefault),
});

/**
 * Return one matchday by its id.
 *
 * Its OWN `saison_id` is resolved rather than the current season's, the derived match count needing
 * that season's rules. A matchday of a season this tier may not read 404s.
 * @summary One Spieltag
 */
export const spieltageGetSpieltagPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltageGetSpieltagParams = zod.object({
  spieltag_id: zod.string().regex(spieltageGetSpieltagPathSpieltagIdRegExp),
});

/**
 * Move a matchday's span.
 *
 * No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span is held
 * to its season's, to the days its own fixtures stand on, and its `beginn` to the order its phase is dated in.
 * @summary Re-date a Spieltag
 */
export const spieltagePatchSpieltagPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltagePatchSpieltagParams = zod.object({
  spieltag_id: zod.string().regex(spieltagePatchSpieltagPathSpieltagIdRegExp),
});

export const spieltagePatchSpieltagBodyBeginnRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spieltagePatchSpieltagBodyEndeRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const SpieltagePatchSpieltagBody = zod.object({
  beginn: zod.string().regex(spieltagePatchSpieltagBodyBeginnRegExp),
  ende: zod.string().regex(spieltagePatchSpieltagBodyEndeRegExp),
});

/**
 * Return one matchday by its id for the admin editor, a `future` season's included.
 *
 * Same shape as `GET /spieltage/{spieltag_id}`, without its season gate: the editor opens a
 * matchday to date it, and that happens before its season is ever activated.
 * @summary One Spieltag for the admin editor
 */
export const spieltageGetSpieltagForAdminPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltageGetSpieltagForAdminParams = zod.object({
  spieltag_id: zod.string().regex(spieltageGetSpieltagForAdminPathSpieltagIdRegExp),
});

/**
 * List teams for a season.
 *
 * `in_gruppen=true` returns the groups the season offers, keyed by group name, otherwise a plain list; check `format`.
 * Omitting `saison_id` returns the CURRENT season; one this tier may not read 404s, and a club that left the league
 * is listed in a `past` season alone.
 * @summary List teams, flat or grouped
 */
export const teamsGetTeamsQueryStatistikScopeDefault = `gruppenphase`;
export const teamsGetTeamsQueryLimitDefault = 1024;
export const teamsGetTeamsQueryLimitMax = 1024;

export const teamsGetTeamsQuerySortByDefault = `name`;
export const teamsGetTeamsQueryOrderDefault = `asc`;

export const TeamsGetTeamsQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  gruppe: zod.union([zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]), zod.null()]).optional(),
  has_austritt: zod.union([zod.boolean(), zod.null()]).optional(),
  austritt_type: zod.union([zod.enum(["disqualifikation", "rueckzug"]), zod.null()]).optional(),
  in_gruppen: zod.union([zod.boolean(), zod.null()]).optional(),
  statistik_scope: zod.enum(["gruppenphase", "gesamt"]).default(teamsGetTeamsQueryStatistikScopeDefault),
  limit: zod.int().min(1).max(teamsGetTeamsQueryLimitMax).default(teamsGetTeamsQueryLimitDefault),
  sort_by: zod.literal("name").default(teamsGetTeamsQuerySortByDefault).meta({ title: "Sort By" }),
  order: zod.enum(["asc", "desc"]).default(teamsGetTeamsQueryOrderDefault),
});

/**
 * Create a club. `shorthand` is unique across every club, retired ones included, so a duplicate is a 409.
 * @summary Create a team
 */
export const teamsPostTeamBodyAddressHausnummerMax = 16;

export const teamsPostTeamBodyAddressHausnummerRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const teamsPostTeamBodyAddressPlzRegExp = new RegExp("^[0-9]{5}$");
export const teamsPostTeamBodyAddressStadtMax = 80;

export const teamsPostTeamBodyAddressStadtteilMax = 80;

export const teamsPostTeamBodyAddressStrasseMax = 120;

export const teamsPostTeamBodyDescriptionMax = 4096;

export const teamsPostTeamBodyFullNameMax = 120;

export const teamsPostTeamBodyFullNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPostTeamBodyNameMax = 60;

export const teamsPostTeamBodyNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPostTeamBodyShorthandRegExp = new RegExp("^\\s*[A-Za-z]{3}\\s*$");
export const teamsPostTeamBodyWebsiteUrlOneMax = 300;

export const TeamsPostTeamBody = zod.object({
  address: zod.object({
    hausnummer: zod.string().max(teamsPostTeamBodyAddressHausnummerMax).regex(teamsPostTeamBodyAddressHausnummerRegExp),
    plz: zod.string().regex(teamsPostTeamBodyAddressPlzRegExp),
    stadt: zod.string().min(1).max(teamsPostTeamBodyAddressStadtMax),
    stadtteil: zod.string().max(teamsPostTeamBodyAddressStadtteilMax),
    strasse: zod.string().min(1).max(teamsPostTeamBodyAddressStrasseMax),
  }),
  description: zod.string().max(teamsPostTeamBodyDescriptionMax),
  full_name: zod.string().min(1).max(teamsPostTeamBodyFullNameMax).regex(teamsPostTeamBodyFullNameRegExp),
  name: zod.string().min(1).max(teamsPostTeamBodyNameMax).regex(teamsPostTeamBodyNameRegExp),
  schulform: zod.union([
    zod.enum(["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]),
    zod.null(),
  ]),
  shorthand: zod.string().regex(teamsPostTeamBodyShorthandRegExp),
  website_url: zod.union([zod.string().max(teamsPostTeamBodyWebsiteUrlOneMax), zod.null()]),
});

/**
 * List a season's teams for the admin surfaces, a `future` season's included.
 *
 * Same filters and shapes as `GET /teams`, without its season gate: a club is entered while its
 * season is still planned, so an admin who cannot see one cannot enter it.
 * @summary Teams for a Saison, for the admin surfaces
 */
export const teamsGetTeamsForAdminQueryStatistikScopeDefault = `gruppenphase`;
export const teamsGetTeamsForAdminQueryLimitDefault = 1024;
export const teamsGetTeamsForAdminQueryLimitMax = 1024;

export const teamsGetTeamsForAdminQuerySortByDefault = `name`;
export const teamsGetTeamsForAdminQueryOrderDefault = `asc`;
export const teamsGetTeamsForAdminQueryIncludeInactiveDefault = false;

export const TeamsGetTeamsForAdminQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  gruppe: zod.union([zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]), zod.null()]).optional(),
  has_austritt: zod.union([zod.boolean(), zod.null()]).optional(),
  austritt_type: zod.union([zod.enum(["disqualifikation", "rueckzug"]), zod.null()]).optional(),
  in_gruppen: zod.union([zod.boolean(), zod.null()]).optional(),
  statistik_scope: zod.enum(["gruppenphase", "gesamt"]).default(teamsGetTeamsForAdminQueryStatistikScopeDefault),
  limit: zod.int().min(1).max(teamsGetTeamsForAdminQueryLimitMax).default(teamsGetTeamsForAdminQueryLimitDefault),
  sort_by: zod.literal("name").default(teamsGetTeamsForAdminQuerySortByDefault).meta({ title: "Sort By" }),
  order: zod.enum(["asc", "desc"]).default(teamsGetTeamsForAdminQueryOrderDefault),
  include_inactive: zod.boolean().default(teamsGetTeamsForAdminQueryIncludeInactiveDefault),
});

/**
 * Retire a club from the league. SOFT: `inactive_since` is stamped and the document stays.
 *
 * Refused while the club is entered in an `active` or `future` season. Its junction rows are left
 * alone: the seasons it played still happened.
 * @summary Retire a team (soft delete)
 */
export const teamsDeleteTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsDeleteTeamParams = zod.object({
  team_id: zod.string().regex(teamsDeleteTeamPathTeamIdRegExp),
});

/**
 * Return one team, with its group and its statistics for a season.
 *
 * The path names WHICH TEAM; the query names WHICH SEASON'S figures: `gruppe` and `statistik` are
 * season-scoped. 404 where the team, its row or the season is one this tier cannot read.
 * @summary One team
 */
export const teamsGetTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamPathTeamIdRegExp),
});

export const teamsGetTeamQueryStatistikScopeDefault = `gruppenphase`;

export const TeamsGetTeamQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  statistik_scope: zod.enum(["gruppenphase", "gesamt"]).default(teamsGetTeamQueryStatistikScopeDefault),
});

/**
 * Update a club, then rewrite the name and shorthand its unfinished seasons carry.
 *
 * The junction and every match hold a copy of both; a `past`
 * season keeps the name it was played under.
 * @summary Update a team and fan the rename out
 */
export const teamsPatchTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPatchTeamParams = zod.object({
  team_id: zod.string().regex(teamsPatchTeamPathTeamIdRegExp),
});

export const teamsPatchTeamBodyAddressHausnummerMax = 16;

export const teamsPatchTeamBodyAddressHausnummerRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const teamsPatchTeamBodyAddressPlzRegExp = new RegExp("^[0-9]{5}$");
export const teamsPatchTeamBodyAddressStadtMax = 80;

export const teamsPatchTeamBodyAddressStadtteilMax = 80;

export const teamsPatchTeamBodyAddressStrasseMax = 120;

export const teamsPatchTeamBodyDescriptionMax = 4096;

export const teamsPatchTeamBodyFullNameMax = 120;

export const teamsPatchTeamBodyFullNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPatchTeamBodyNameMax = 60;

export const teamsPatchTeamBodyNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPatchTeamBodyShorthandRegExp = new RegExp("^\\s*[A-Za-z]{3}\\s*$");
export const teamsPatchTeamBodyWebsiteUrlOneMax = 300;

export const TeamsPatchTeamBody = zod.object({
  address: zod.object({
    hausnummer: zod.string().max(teamsPatchTeamBodyAddressHausnummerMax).regex(teamsPatchTeamBodyAddressHausnummerRegExp),
    plz: zod.string().regex(teamsPatchTeamBodyAddressPlzRegExp),
    stadt: zod.string().min(1).max(teamsPatchTeamBodyAddressStadtMax),
    stadtteil: zod.string().max(teamsPatchTeamBodyAddressStadtteilMax),
    strasse: zod.string().min(1).max(teamsPatchTeamBodyAddressStrasseMax),
  }),
  description: zod.string().max(teamsPatchTeamBodyDescriptionMax),
  full_name: zod.string().min(1).max(teamsPatchTeamBodyFullNameMax).regex(teamsPatchTeamBodyFullNameRegExp),
  name: zod.string().min(1).max(teamsPatchTeamBodyNameMax).regex(teamsPatchTeamBodyNameRegExp),
  schulform: zod.union([
    zod.enum(["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]),
    zod.null(),
  ]),
  shorthand: zod.string().regex(teamsPatchTeamBodyShorthandRegExp),
  website_url: zod.union([zod.string().max(teamsPatchTeamBodyWebsiteUrlOneMax), zod.null()]),
});

/**
 * Clear `inactive_since`, restoring a retired club to reads that hide retired ones.
 * @summary Bring a retired team back
 */
export const teamsReactivateTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsReactivateTeamParams = zod.object({
  team_id: zod.string().regex(teamsReactivateTeamPathTeamIdRegExp),
});

/**
 * Enter a team into a season, in a group, under the name the club carries today.
 *
 * A club with no row here is ABSENT from that season rather than merely unlisted.
 * @summary Enter a team into a season
 */
export const teamsPostSaisonTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPostSaisonTeamParams = zod.object({
  team_id: zod.string().regex(teamsPostSaisonTeamPathTeamIdRegExp),
});

export const teamsPostSaisonTeamBodySaisonIdMin = 4;
export const teamsPostSaisonTeamBodySaisonIdMax = 4;

export const TeamsPostSaisonTeamBody = zod
  .object({
    gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
    saison_id: zod.string().min(teamsPostSaisonTeamBodySaisonIdMin).max(teamsPostSaisonTeamBodySaisonIdMax),
  })
  .describe("One team's membership of one season. `team_id` comes from the path, `saison_id` from here.");

/**
 * Rewrite a team's row for one season: group, exit record and kit colour.
 *
 * All three are required and replaced WHOLESALE: an omitted key is a 422, never a team reinstated.
 * The contact block is `PATCH .../kontakte`'s.
 * @summary Rewrite a team's season row: group, exit record and kit colour
 */
export const teamsPatchSaisonTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPatchSaisonTeamParams = zod.object({
  team_id: zod.string().regex(teamsPatchSaisonTeamPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsPatchSaisonTeamBodyAustrittOneDatumRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const TeamsPatchSaisonTeamBody = zod
  .object({
    austritt: zod.union([
      zod
        .object({
          datum: zod.string().regex(teamsPatchSaisonTeamBodyAustrittOneDatumRegExp),
          grund: zod.string().min(1),
          type: zod.enum(["disqualifikation", "rueckzug"]),
        })
        .describe(
          "How a team came to be out of one season, why, and from when.\n\n`grund` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no\ndisciplinary code an enum could cite.",
        ),
      zod.null(),
    ]),
    gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
    trikot_farbe: zod.union([
      zod.enum([
        "schwarz",
        "weiss",
        "grau",
        "braun",
        "bordeaux",
        "rot",
        "koralle",
        "orange",
        "gold",
        "gelb",
        "limette",
        "hellgruen",
        "gruen",
        "smaragd",
        "tuerkis",
        "cyan",
        "hellblau",
        "meerblau",
        "blau",
        "dunkelblau",
        "flieder",
        "violett",
        "magenta",
        "rosa",
      ]),
      zod.null(),
    ]),
  })
  .describe(
    "The row's own fields. NO `kontakte`: `FLPatchSaisonTeamKontaktePayload` owns it.\n\nA stored contact is shapeless on read and bounded on write, so round-tripping it here refuses\nevery save a club with one bad row can make.",
  );

/**
 * Stamp this team's live registration link revoked, so it opens nothing from here on.
 *
 * The row stays: a delivery event about a message carrying that link still has somewhere to land, and a reissue's history is what says
 * which link a bounce was about. 404 where the team holds no live link for the season; a link of a season that has ended stays revocable.
 * @summary Revoke this team's live registration link for a season
 */
export const teamsDeleteEinladungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsDeleteEinladungParams = zod.object({
  team_id: zod.string().regex(teamsDeleteEinladungPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * What this team's live registration link for the season is, or that it holds none, beside the window deciding what it opens.
 *
 * **No hash and no raw value**: the link itself was answered once, by the mint. What is served is who minted it and when, and what became
 * of the last message sent about it — a `versand.zustellung` absent, or naming no message, means nobody has mailed it, which is a state
 * rather than a delivery failure. The minter is `null` beside `erstellt_von_gesperrt` where the ban list holds that address, as no barred
 * address is served in plain.
 *
 * `laeuft` is the season's registration window judged against today, and false for good once the season has ended; it is the whole of
 * the link's expiry. 404 where no season holds that id; a team with no invitation answers `einladung: null` rather than a 404.
 * @summary This team's live registration link for a season, and whether it opens anything
 */
export const teamsGetEinladungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetEinladungParams = zod.object({
  team_id: zod.string().regex(teamsGetEinladungPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Mint the link a team's players register through, revoking whatever link that team held for this season.
 *
 * **The raw link value is in this answer and in no other, ever**: the row stores an unkeyed SHA-256 of it, so a link nobody copied out of
 * this response is lost and the repair is another mint. Mailing it is a separate press.
 *
 * The reissue is part of the same transaction, so the previous link stops opening anything the moment this answers, and the team is left
 * holding exactly one live invitation. The link carries no date: it expires with the season's registration window, which is judged afresh
 * every time somebody opens it, so a window moved after the mint moves this link with it.
 *
 * Refused where the season holds no junction row for this team (`REQ-EINLADUNG-001`) and where the season has ended
 * (`REQ-EINLADUNG-002`); a `future` season mints, the links being prepared before the window opens. 404 where no season holds that id.
 *
 * **A team that has left the season still mints here**, where the season-wide send passes it over: this call names one team an
 * administrator is looking at, and a squad row and a contact correction are accepted for such a team too.
 *
 * A mint voiding a live link is refused `REQ-AUTH-009` from a sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`, and
 * writes nothing; a team's first link is not.
 * @summary Mint this team's registration link for a season
 */
export const teamsPostEinladungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPostEinladungParams = zod.object({
  team_id: zod.string().regex(teamsPostEinladungPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Rewrite the three people this team is reached through for one season. Null clears the block.
 *
 * Its own endpoint so the contacts editor and the club editor cannot clobber one row. The one
 * rule's refusal is `REQ-KONTAKT-001`: the body echoes back the `kontakte_stand` its caller was served
 * beside the block, and a row whose block answers to another token is refused rather than
 * overwritten, an erasure between the caller's read and this write being what moves it. A clearing,
 * which nothing restores, is refused `REQ-AUTH-009` from a sign-in or confirmation older than
 * `STEP_UP_WINDOW_HOURS`. A `past` season's contacts stay correctable. Each seat's `eingetragen_von` and
 * `bestaetigt_am` are the server's: a seat keeping its person keeps both, and a seat newly filled or handed
 * on is stored as the league's entry, unconfirmed.
 *
 * **Each person the save newly seats is minted a confirmation link**, answered raw once in `bestaetigungen` for the
 * caller to mail: one per person, covering both seats where the Trainer holds a second. A seat keeping its person
 * keeps their link, and a seat emptied or handed on loses the one it held and its links on the team's open match
 * confirmations, so the person who left it holds nothing live. A save newly seating an address the ban list holds is
 * refused `REQ-KONTAKT-003`, as the re-send to one is. On a row of a `past` season, or of a team that has left it, the
 * link is how its person learns of the entry, and it takes their Widerspruch alone. A save minting a link, emptying
 * or handing on a seat, or voiding a link its person could still answer, is refused `REQ-AUTH-009` as the clearing
 * is; a save doing none of these is not.
 *
 * **Each mailbox the save takes off a seat is answered in `abgaenge`** for the caller to tell, with every seat it
 * lost, a mailbox still holding another seat of the row included. A mailbox the save mints a link is not one: that
 * link's mail names the seats it holds now.
 *
 * **A seat the same person keeps keeps its record whole**, each choice and its evidence included; a seat newly filled
 * or handed to another person is born granting nothing, its media consent off and no choice evidenced, since only a
 * person's own write grants one. Such a seat's label must be the application form's running one
 * (`REQ-EINWILLIGUNG-001`). A kept seat may name its stored label back, whichever page it is a version of, or the
 * running one, and its record is carried either way.
 * @summary Rewrite a team's season contacts, and nothing else on the row
 */
export const teamsPatchSaisonTeamKontaktePathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPatchSaisonTeamKontakteParams = zod.object({
  team_id: zod.string().regex(teamsPatchSaisonTeamKontaktePathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneEinwilligungDatumRegExp = new RegExp(
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
);
export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneEinwilligungTextVersionMax = 64;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneEmailMax = 254;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneNachnameMax = 80;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneVornameMax = 80;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneEinwilligungDatumRegExp = new RegExp(
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
);
export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneEinwilligungTextVersionMax = 64;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneEmailMax = 254;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneNachnameMax = 80;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneVornameMax = 80;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneEinwilligungDatumRegExp = new RegExp(
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
);
export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneEinwilligungTextVersionMax = 64;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneEmailMax = 254;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneNachnameMax = 80;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneNachnameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneTelefonRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneVornameMax = 80;

export const teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneVornameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");

export const TeamsPatchSaisonTeamKontakteBody = zod
  .object({
    kontakte: zod.union([
      zod
        .object({
          ansprechperson: zod.union([
            zod.object({
              einwilligung: zod.object({
                datum: zod.string().regex(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneEinwilligungDatumRegExp),
                text_version: zod.string().min(1).max(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneEinwilligungTextVersionMax),
                umfang: zod.literal("kontaktdaten").meta({ title: "Umfang" }),
              }),
              email: zod.string().max(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneEmailMax),
              nachname: zod
                .string()
                .min(1)
                .max(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneNachnameMax)
                .regex(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneNachnameRegExp),
              telefon: zod.string().regex(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneTelefonRegExp),
              vorname: zod
                .string()
                .min(1)
                .max(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneVornameMax)
                .regex(teamsPatchSaisonTeamKontakteBodyKontakteOneAnsprechpersonOneVornameRegExp),
            }),
            zod.null(),
          ]),
          stellvertretung: zod.union([
            zod.object({
              einwilligung: zod.object({
                datum: zod.string().regex(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneEinwilligungDatumRegExp),
                text_version: zod.string().min(1).max(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneEinwilligungTextVersionMax),
                umfang: zod.literal("kontaktdaten").meta({ title: "Umfang" }),
              }),
              email: zod.string().max(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneEmailMax),
              nachname: zod
                .string()
                .min(1)
                .max(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneNachnameMax)
                .regex(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneNachnameRegExp),
              telefon: zod.string().regex(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneTelefonRegExp),
              vorname: zod
                .string()
                .min(1)
                .max(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneVornameMax)
                .regex(teamsPatchSaisonTeamKontakteBodyKontakteOneStellvertretungOneVornameRegExp),
            }),
            zod.null(),
          ]),
          trainer: zod.union([
            zod.object({
              einwilligung: zod.object({
                datum: zod.string().regex(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneEinwilligungDatumRegExp),
                text_version: zod.string().min(1).max(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneEinwilligungTextVersionMax),
                umfang: zod.literal("kontaktdaten").meta({ title: "Umfang" }),
              }),
              email: zod.string().max(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneEmailMax),
              nachname: zod
                .string()
                .min(1)
                .max(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneNachnameMax)
                .regex(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneNachnameRegExp),
              telefon: zod.string().regex(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneTelefonRegExp),
              vorname: zod
                .string()
                .min(1)
                .max(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneVornameMax)
                .regex(teamsPatchSaisonTeamKontakteBodyKontakteOneTrainerOneVornameRegExp),
            }),
            zod.null(),
          ]),
          trainer_ist_zugleich: zod.union([zod.enum(["ansprechperson", "stellvertretung"]), zod.null()]),
        })
        .describe(
          "The write side of the three, with the empty slot an erasure leaves.\n\nThree whole people is the editor's own guarantee\n(`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteSection.tsx`).",
        ),
      zod.null(),
    ]),
    kontakte_stand: zod.string(),
  })
  .describe(
    'The contact block alone, plus the token naming which block it was composed against.\n\n`extra="forbid"`: a `gruppe` or an `austritt` sent here is a 422 rather than a value this\nendpoint was never asked to decide.',
  );

/**
 * Mint a fresh confirmation link for one contact seat and answer it raw once, for the caller to mail.
 *
 * It replaces the seat's link WHOLE, and its pair's where the Trainer holds both and has not confirmed the other:
 * the previous link stops opening anything, the delivery state of the message it went out in goes with it, and the
 * deadline restarts from today.
 *
 * Refused where the season has ended or the team has left it (`REQ-KONTAKT-005`), where the seat holds nobody or its
 * person has already confirmed it (`REQ-KONTAKT-002`), and where its address is on the ban list (`REQ-KONTAKT-003`).
 * 404 for a team and season holding no row, and for a path naming no seat. Every call mints, so every call from a
 * sign-in or confirmation older than `STEP_UP_WINDOW_HOURS` is refused `REQ-AUTH-009`.
 * @summary Send one contact seat a fresh confirmation link
 */
export const teamsEinladenKontaktPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsEinladenKontaktParams = zod.object({
  team_id: zod.string().regex(teamsEinladenKontaktPathTeamIdRegExp),
  saison_id: zod.string(),
  seat: zod.string(),
});

/**
 * Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.
 *
 * One answer for all of them: a person holding two of the row's slots answers once, each choice moving only where it
 * differs from the row as the page served it, so seats answered apart keep their answers to a choice not changed. No
 * other slot of the row and no other row is written, each choice moving with its own evidence and leaving the
 * other standing; a press moving no seat writes nothing. A GRANT (`umfang` to `kontaktdaten_whatsapp` or `medien`
 * to `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
 * person confirmed a seat on, a past season's included.
 *
 * Refuses, in this order: a row on which the address holds no confirmed seat (`REQ-FUNKTION-001`); a
 * `nachweis_stand` other than the held seats' own, either choice having moved since the page was served
 * (`REQ-EINWILLIGUNG-003`); a grant where the row grants no panel (`REQ-EINWILLIGUNG-004`); a `text_version` naming no
 * version of the account page's seat control, or a grant naming any but its running one (`REQ-EINWILLIGUNG-001`);
 * `medien` moving to `true` where a held seat's stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is
 * missing (`REQ-EINWILLIGUNG-002`); and a grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`),
 * which counts grants alone, so a withdrawal is never refused for it. Each refusal writes nothing.
 * @summary Change a seat holder's own WhatsApp and media consent on one team's season
 */
export const teamsPatchEinwilligungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPatchEinwilligungParams = zod.object({
  team_id: zod.string().regex(teamsPatchEinwilligungPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsPatchEinwilligungBodyTextVersionMax = 64;

export const TeamsPatchEinwilligungBody = zod.object({
  medien: zod.boolean(),
  nachweis_stand: zod.object({
    medien: zod.union([zod.string(), zod.null()]),
    umfang: zod.union([zod.string(), zod.null()]),
  }),
  text_version: zod.string().min(1).max(teamsPatchEinwilligungBodyTextVersionMax),
  umfang: zod.enum(["kontaktdaten", "kontaktdaten_whatsapp"]),
});

/**
 * The team's three seats in this season, each with its holder's name and whether that person has confirmed it.
 *
 * Always three lines, an empty slot answered with no name. No seat's address, telephone number, birthdate or
 * confirmation date is served, whoever asks.
 * @summary A team's seats in one season
 */
export const teamsGetTeamSitzePathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamSitzeParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamSitzePathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Hand this season's junction row, and every fixture on it, to another club.
 *
 * Its `team_id`, identity copy, `austritt` and every fixture side move, and the outgoing club's
 * live squad rows are retired, in ONE transaction: the schedule survives.
 * @summary Replace a club in a season, keeping its schedule
 */
export const teamsReplaceSaisonTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsReplaceSaisonTeamParams = zod.object({
  team_id: zod.string().regex(teamsReplaceSaisonTeamPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsReplaceSaisonTeamBodyIncomingTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsReplaceSaisonTeamBody = zod
  .object({
    incoming_team_id: zod.string().regex(teamsReplaceSaisonTeamBodyIncomingTeamIdRegExp),
  })
  .describe("Which club takes this season's row over. The path names the club going OUT.");

/**
 * Record what the mail provider reported about one message, on the record that message was sent about.
 *
 * Applied only where the event names the message the record still holds AND is stamped strictly later than the state it holds: a
 * re-send mints a new message, so the old one's bounce must not mark the fresh link, and a redelivery or an event overtaken by a
 * later one changes nothing. Both are answered with `angewendet: false` rather than with a refusal, because the provider retries
 * anything but a success and would resend a settled event for hours.
 *
 * 404 where no document of that kind has the id, which a record erased between the send and the event is: a caller that must not
 * retry maps it rather than repeating the call.
 *
 * A `kontakt` or `spielbestaetigung` record sits under each contact seat, so its report names in `rollen` every seat the one message
 * reached, each judged and written on its own, and `angewendet` is true where any was; every other kind names none, a mismatch being a
 * 422.
 * @summary Apply one delivery event to the record its message was sent about
 */
export const zustellungPostZustellungBodyAmMax = 64;

export const zustellungPostZustellungBodyGrundOneMax = 128;

export const zustellungPostZustellungBodyGrundOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const zustellungPostZustellungBodyNachrichtIdMax = 128;

export const zustellungPostZustellungBodyZielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const ZustellungPostZustellungBody = zod
  .object({
    am: zod.string().min(1).max(zustellungPostZustellungBodyAmMax),
    grund: zod.union([zod.string().max(zustellungPostZustellungBodyGrundOneMax).regex(zustellungPostZustellungBodyGrundOneRegExp), zod.null()]),
    nachricht_id: zod.string().min(1).max(zustellungPostZustellungBodyNachrichtIdMax),
    rollen: zod.array(zod.enum(["trainer", "ansprechperson", "stellvertretung"])),
    stand: zod.enum(["zugestellt", "verzoegert", "unzustellbar", "unterdrueckt", "beschwerde"]),
    ziel: zod.enum(["schiedsrichter", "einladung", "registrierung", "kontakt", "adresswechsel", "spielbestaetigung"]),
    ziel_id: zod.string().regex(zustellungPostZustellungBodyZielIdRegExp),
  })
  .describe("One delivery event about a message this record was sent.");

/**
 * Record that the mail provider refused the send itself, so no message about this record exists.
 *
 * The send is where a refused address is learnt at all: nothing is minted, no delivery event ever follows, and a record left without
 * this state is one the reminder clocks chase and the deadline clocks erase as though the link had been read.
 *
 * Judged as an accepted send is, both stamps being this sender's: applied only where this refusal is newer than the ACCEPT the record
 * already holds, so a call retried after the re-send that repaired the address writes nothing, and a delivery state the provider
 * stamped never blocks it. A record whose document carries no delivery bookkeeping at all is skipped rather than refused. 404 where no
 * document of that kind has the id.
 *
 * A `kontakt` or `spielbestaetigung` record sits under each contact seat, so its report names in `rollen` every seat the one message
 * reached, each judged and written on its own, and `angewendet` is true where any was; every other kind names none, a mismatch being a
 * 422.
 * @summary Record the send the provider refused for this record
 */
export const zustellungAbgewiesenZustellungBodyAmMax = 64;

export const zustellungAbgewiesenZustellungBodyGrundOneMax = 128;

export const zustellungAbgewiesenZustellungBodyGrundOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const zustellungAbgewiesenZustellungBodyZielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const ZustellungAbgewiesenZustellungBody = zod
  .object({
    am: zod.string().min(1).max(zustellungAbgewiesenZustellungBodyAmMax),
    grund: zod.union([
      zod.string().max(zustellungAbgewiesenZustellungBodyGrundOneMax).regex(zustellungAbgewiesenZustellungBodyGrundOneRegExp),
      zod.null(),
    ]),
    rollen: zod.array(zod.enum(["trainer", "ansprechperson", "stellvertretung"])),
    ziel: zod.enum(["schiedsrichter", "einladung", "registrierung", "kontakt", "adresswechsel", "spielbestaetigung"]),
    ziel_id: zod.string().regex(zustellungAbgewiesenZustellungBodyZielIdRegExp),
  })
  .describe("A send the provider refused outright. No `nachricht_id`: nothing was minted, so there is no message for a later event to join.");

/**
 * Record that the mail provider accepted one message about the record named, under the id it answered with.
 *
 * That id is the only join between a send and any later delivery event, so a record carrying none is a record every event about it
 * is discarded for. Accepting a request is not delivering it: what this records is that the provider took the message, and
 * `POST /zustellung` is where the recipient's own mail server is heard from.
 *
 * Applied only where this send is newer than the ACCEPT the record already holds, so a call retried after a later one landed
 * writes nothing, and the answer says whether anything was written; a delivery state the provider stamped never blocks it, that
 * stamp being the provider's clock rather than this sender's. A record whose document carries no delivery bookkeeping at all --
 * never mailed, or emptied by an erasure -- is skipped rather than refused. 404 where no document of that kind has the id.
 *
 * A `kontakt` or `spielbestaetigung` record sits under each contact seat, so its report names in `rollen` every seat the one message
 * reached, each judged and written on its own, and `angewendet` is true where any was; every other kind names none, a mismatch being a
 * 422.
 * @summary Record the message the provider accepted for this record
 */
export const zustellungAngenommenZustellungBodyAmMax = 64;

export const zustellungAngenommenZustellungBodyNachrichtIdMax = 128;

export const zustellungAngenommenZustellungBodyZielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const ZustellungAngenommenZustellungBody = zod
  .object({
    am: zod.string().min(1).max(zustellungAngenommenZustellungBodyAmMax),
    nachricht_id: zod.string().min(1).max(zustellungAngenommenZustellungBodyNachrichtIdMax),
    rollen: zod.array(zod.enum(["trainer", "ansprechperson", "stellvertretung"])),
    ziel: zod.enum(["schiedsrichter", "einladung", "registrierung", "kontakt", "adresswechsel", "spielbestaetigung"]),
    ziel_id: zod.string().regex(zustellungAngenommenZustellungBodyZielIdRegExp),
  })
  .describe("One message the provider accepted for this record. `stand` is not a key: this endpoint records `angenommen` and no other state.");
