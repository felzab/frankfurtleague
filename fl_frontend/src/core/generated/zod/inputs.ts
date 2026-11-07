import "server-only";

import * as zod from "zod";

/**
 * Start a change of the address the person signs in on, its first mail owed in the same transaction and no link answered.
 *
 * **The address on file confirms first**: it is owed a link, and only its confirmation owes the new mailbox the
 * second; **everything the address holds as its person's own moves when the new mailbox confirms**, each link within
 * `ADDRESS_CHANGE_VALID_HOURS`, and declining either ends the change. Where it holds a grant, the change also waits on
 * another administrator's approval, an owner's for an owner's grant. The address's live change ends replaced, an
 * administrator's too: a sign-in at the address on file proves the mailbox is not lost.
 * **Nothing about the new address is judged here** -- the ban list, another pupil, a grant it holds -- so this start
 * answers alike whatever the new address holds.
 *
 * Refused `address_change_started_recently`, a 429 whose `Retry-After` names the seconds left, where the address's
 * live change owed its last mail less than `ADDRESS_CHANGE_RESTART_SECONDS` ago; `address_change_nothing` where the
 * address holds nothing a change moves; `address_change_unchanged` where the typed address is the one signed in; and
 * `address_change_no_approver` where nobody could approve the grant's move, the last owner making another first.
 * @summary Start a change of the signed-in person's address
 */
export const accountPostAddressChangeBodyEmailMax = 254;

export const AccountPostAddressChangeBody = zod.object({
  email: zod.string().max(accountPostAddressChangeBodyEmailMax),
});

/**
 * List recorded writes newest first, `complete` false where `limit` cut them, an actor's `email` null where the ban list holds it.
 *
 * `collection`, `operation` and `herkunft` take a comma-joined or repeated selection, and each
 * `anzahl_je_*` count applies every filter but its own facet, a value nothing was recorded under absent.
 * @summary List recorded admin actions
 */
export const actionLogGetActionLogQueryLimitDefault = 1024;
export const actionLogGetActionLogQueryLimitMax = 1024;

export const ActionLogGetActionLogQueryParams = zod.object({
  collection: zod.union([zod.array(zod.string()), zod.null()]).optional(),
  operation: zod
    .union([zod.array(zod.enum(["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"])), zod.null()])
    .optional(),
  herkunft: zod.union([zod.array(zod.enum(["person", "system", "public"])), zod.null()]).optional(),
  trace_id: zod.union([zod.string(), zod.null()]).optional(),
  document_id: zod.union([zod.string(), zod.null()]).optional(),
  limit: zod.int().min(1).max(actionLogGetActionLogQueryLimitMax).default(actionLogGetActionLogQueryLimitDefault),
  order: zod.enum(["asc", "desc"]).optional(),
});

/**
 * One recorded write with the document it replaced, served as recorded; the actor is withheld as the list withholds it.
 * @summary One recorded admin action
 */
export const actionLogGetActionLogEntryPathActionLogEntryIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const ActionLogGetActionLogEntryParams = zod.object({
  action_log_entry_id: zod.string().regex(actionLogGetActionLogEntryPathActionLogEntryIdRegExp),
});

/**
 * Start a change of the typed address for a person who says they cannot sign in, its mails owed in the same transaction.
 *
 * **Nothing moves here.** The `change_reason` records how the administrator established who asks, the address on file being
 * lost: a person who can still sign in there changes it on their own account page. The new mailbox is owed its link
 * and the address on file a notice with its stop link; the change then takes effect
 * `ADDRESS_CHANGE_WAITING_PERIOD_DAYS` after the new mailbox confirms. Where the address holds a grant, the change also
 * waits on another administrator's approval, never this one's. No link is answered. The address's live change ends
 * replaced.
 *
 * Refused the administrator's own address (`own_address`), a grant holder's without an owner's power
 * (`admin_address`), the address on file typed again (`address_change_unchanged`), a new address the ban list holds
 * (`address_change_barred`), an address holding nothing a change moves (`address_change_nothing`), a new address another pupil signs in on
 * where the change moves a pupil (`address_change_taken`), a new address any entry names, confirmed or not (`address_change_occupied`), and a
 * grant nobody could approve (`address_change_no_approver`).
 * @summary Start an address change for a person who says they cannot sign in
 */
export const addressChangePostAddressChangeAdminBodyAddressMax = 254;

export const addressChangePostAddressChangeAdminBodyChangeReasonMax = 200;

export const addressChangePostAddressChangeAdminBodyChangeReasonRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const addressChangePostAddressChangeAdminBodyEmailMax = 254;

export const AddressChangePostAddressChangeAdminBody = zod
  .object({
    address: zod.string().max(addressChangePostAddressChangeAdminBodyAddressMax),
    change_reason: zod
      .string()
      .min(1)
      .max(addressChangePostAddressChangeAdminBodyChangeReasonMax)
      .regex(addressChangePostAddressChangeAdminBodyChangeReasonRegExp),
    email: zod.string().max(addressChangePostAddressChangeAdminBodyEmailMax),
  })
  .describe("The address a change starts on, the address it goes to, and how the administrator established who asks for it.");

/**
 * Answer the new address of the live change the new mailbox's link token or the change's id names, folded to the sign-in identifier.
 *
 * For the frontend's server alone, which asks its sign-in store whether an account stands there before a press, a link's
 * view or an approval; the link's own view never serves the address. A token or id naming no live change -- unknown,
 * ended, or the stop link's token -- is answered null rather than refused, so a lapsed or answered link costs no
 * error. Stores nothing, and a POST for `POST /identity/subject`'s reason: the token travels in the body, and the
 * address only in the answer.
 * @summary Say which address a live change would move to
 */
export const addressChangeGetAddressChangeAddressBodyAddressChangeIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const addressChangeGetAddressChangeAddressBodyTokenOneMax = 128;

export const addressChangeGetAddressChangeAddressBodyTokenOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const AddressChangeGetAddressChangeAddressBody = zod
  .object({
    address_change_id: zod.union([zod.string().regex(addressChangeGetAddressChangeAddressBodyAddressChangeIdOneRegExp), zod.null()]).optional(),
    token: zod
      .union([
        zod
          .string()
          .min(1)
          .max(addressChangeGetAddressChangeAddressBodyTokenOneMax)
          .regex(addressChangeGetAddressChangeAddressBodyTokenOneRegExp),
        zod.null(),
      ])
      .optional(),
  })
  .describe("Exactly one key: the new mailbox's link token, or the change an approval names.");

/**
 * Record whether the mailbox this link was sent to is the person's: `confirmed` confirms it, `declined` ends the change.
 *
 * **The person's own change asks the address on file first**: its link's confirmation owes the new mailbox its link,
 * and nothing moves yet, answering `confirmed` with `effective` false, `effective_from` null and `approval_open` saying
 * whether the change will wait on another administrator's approval of the grant it moves; refused `link_expired` past
 * that link's deadline and `address_change_ended` once answered or ended, a decline refused only the latter, and a
 * decline is the one way this link ends the change before it confirmed (`/stop` refuses it). Every other link the
 * address on file was mailed answers no confirmation (`link_invalid`).
 *
 * The new mailbox's link: **a confirmation moves the person, not a record.** Unless the change waits -- on a waiting time an administrator's
 * start with a reason asked, or on another administrator's approval of the grant it moves -- it takes effect in this
 * transaction: every pupil row, confirmed referee row, confirmed contact seat, registration and grant the address on
 * file holds moves to the new one, asking no consent and writing none, and `effective` says so; its completion notice is
 * owed in this transaction, and so is its sign-in account's carry. A change that waits is confirmed alone,
 * answering `effective_from` or `approval_open`.
 * Either answer spends the link, which keeps answering what became of the change.
 *
 * Refuses a token no change holds (`link_invalid`), a link already answered or a change ended
 * (`address_change_ended`), and, in the order the link's view ranks its states, a CONFIRMATION through a link mailed to
 * an address the ban list holds now (`link_barred`), one past its deadline (`link_expired`), one whose change would replace an address
 * the ban list holds now (`address_change_replaced_barred`), so a barred person cannot move their records off the address the ban keys on,
 * one moving a pupil onto an address another pupil signs in on (`address_change_taken`), one whose address came to hold a grant its approval
 * does not cover (`address_change_not_covered`), one moving a grant onto an address holding one (`address_change_new_granted`), and one
 * whose new address any entry names, confirmed or not, an open grant request among them (`address_change_occupied`): moving the person onto it
 * would join two people's records. **A decline is refused none of these**: it removes an address nobody proved, out of every log image of the
 * change too.
 *
 * A change whose address has come to hold nothing to move ends discarded, and the press answers `address_change_ended`. The codes past
 * `link_barred` tell a caller what the view's `not_confirmable` keeps alike; only the edge keeps them from the link's holder.
 * @summary Confirm or decline a pending address
 */
export const addressChangePostAddressChangeAnswerBodyTokenMax = 128;

export const addressChangePostAddressChangeAnswerBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const AddressChangePostAddressChangeAnswerBody = zod.object({
  answer: zod.enum(["confirmed", "declined"]),
  token: zod.string().min(1).max(addressChangePostAddressChangeAnswerBodyTokenMax).regex(addressChangePostAddressChangeAnswerBodyTokenRegExp),
});

/**
 * Stop the change the address on file was mailed about: its new address goes, out of every log image of the change too.
 *
 * **Refused nothing but a token no change holds, a change ended, and the person's own change before its address on file
 * confirmed it**: a stop hands nothing over, so it answers past every deadline, a barred address's holder too, until
 * the change ends. A token no change holds answers `link_invalid` and an ended change `address_change_ended`. The
 * person's own change offers this link no stop until its address on file confirmed it, and answers `link_invalid` as
 * the unknown token does, the page offering no stop then: the question's decline is the one way that link ends it
 * before, so one act keeps one ending. From that confirmation on, the same link is the change's stop on every way.
 * @summary Stop a pending address change
 */
export const addressChangePostAddressChangeStopBodyTokenMax = 128;

export const addressChangePostAddressChangeStopBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const AddressChangePostAddressChangeStopBody = zod
  .object({
    token: zod.string().min(1).max(addressChangePostAddressChangeStopBodyTokenMax).regex(addressChangePostAddressChangeStopBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * Answer what this token opens: the new mailbox's link, the link the address on file was mailed, or how either's change ended.
 *
 * **Nothing else about the change**: never a name or the id, and the new address only on the two questions, the new
 * mailbox's `valid` link and the address on file's `release_open` link of the person's own change. A POST that reads,
 * so the token travels in a body and never in a second URL. Refuses only a token no change holds (`link_invalid`); an ended change's
 * links answer `ended`, how it ended and on which day, for as long as its record is kept.
 *
 * The new mailbox's side is served in a state: once pressed, `confirmed`, or `approval_expired` where its
 * approval week lapsed unapproved; else `barred` wherever the ban list holds the address the link was mailed to, then
 * `expired`, then `not_confirmable` wherever the press would be refused for the address on file's sake or would
 * find it holding nothing to move, each a state the confirmation is refused in. Those read alike here, though the press
 * answers each by its own code; what keeps the link's holder from telling them apart is the edge, where
 * the proxy routes no public call to this service. The address on file's side answers the step the change waits on
 * and until when, `release_open` while the person's own change waits on this link's confirmation and `release_expired` once that lapsed,
 * never whether the new mailbox could confirm, and the day it confirmed once it has.
 * @summary What one address link opens
 */
export const addressChangeGetAddressChangeViewBodyTokenMax = 128;

export const addressChangeGetAddressChangeViewBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const AddressChangeGetAddressChangeViewBody = zod
  .object({
    token: zod.string().min(1).max(addressChangeGetAddressChangeViewBodyTokenMax).regex(addressChangeGetAddressChangeViewBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * End a bounded share of the live changes whose waiting step lapsed, and make the due ones take effect.
 *
 * **A lapsed change** -- its new mailbox's link, the question it asked the address on file, or its grant's approval by
 * another administrator -- ends as `expired`: its address and reason out of the record and every log image of it
 * (`removed`). **A due change**, one whose waiting time has ended and whose grant's move, where its address still
 * holds the grant, was approved, is judged again as its confirmation was: a ban on either address, another pupil
 * signing in on the new one, a grant its approval does not cover, a grant at the new address, or nothing left to move
 * ends it discarded, and
 * `discarded` counts it, its new address owed a notice that it did not take effect and never why; otherwise
 * everything the replaced address holds moves, and `effective` counts it, its completion notice owed. Each notice is owed
 * in the Postausgang in its change's own transaction, so none rides on this answer.
 *
 * Each change is handled in a transaction of its own that judges it again, so one confirmed, stopped, discarded or
 * replaced since this call read it is left standing. **A pass is a run of calls, each handing the next the `after` the last
 * answered**, the first naming none; it ends at the call answering `after` null. A call reaches at most a fixed share of the
 * changes after `after`, in `_id` order, and the pass holds no state on the server. A change whose handling fails is
 * logged by its id and passed, holding back nobody behind it; it stays due, and the next pass tries it again. Where the
 * request's deadline cuts the call, it stops at that change, warns once, and answers what it did. `remaining` counts
 * the changes standing due after the call, so it is no stopping condition.
 * @summary End the lapsed address changes, and make the due ones take effect
 */
export const addressChangeSweepAddressChangeQueryAfterOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangeSweepAddressChangeQueryParams = zod.object({
  after: zod.union([zod.string().regex(addressChangeSweepAddressChangeQueryAfterOneRegExp), zod.null()]).optional(),
});

/**
 * Take the owed carry off each named change, counting the ones that owed one; an id owing none is left alone.
 * @summary Take the carries done off their changes
 */
export const addressChangePostAddressChangeMovesDoneBodyIdsItemRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const addressChangePostAddressChangeMovesDoneBodyIdsMax = 1024;

export const AddressChangePostAddressChangeMovesDoneBody = zod.object({
  ids: zod
    .array(zod.string().regex(addressChangePostAddressChangeMovesDoneBodyIdsItemRegExp))
    .min(1)
    .max(addressChangePostAddressChangeMovesDoneBodyIdsMax),
});

/**
 * Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.
 *
 * ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
 * never a hash. `possible` where the address holds anything a change moves, a grant included. Stores nothing.
 *
 * Refused as the erasure's reveal is: the administrator's own address (`own_address`), and an address holding a live
 * grant unless the administrator holds an owner's power (`admin_address`). A change id answers 404 where no change is
 * kept, and `address_change_ended` where it ended.
 * @summary Show what an address holds that a change moves, and its live change
 */
export const addressChangeGetAddressChangeAdminViewBodyAddressOneMax = 254;

export const addressChangeGetAddressChangeAdminViewBodyAddressChangeIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangeGetAddressChangeAdminViewBody = zod
  .object({
    address: zod.union([zod.string().max(addressChangeGetAddressChangeAdminViewBodyAddressOneMax), zod.null()]).optional(),
    address_change_id: zod
      .union([zod.string().regex(addressChangeGetAddressChangeAdminViewBodyAddressChangeIdOneRegExp), zod.null()])
      .optional(),
  })
  .describe("Exactly one key: the address typed, or the change a page links to.");

/**
 * Discard the change this id names: its links open nothing to press, and the address on file stays.
 *
 * **Its address goes from the action log too**: every image the log holds of the change
 * loses its new address and reason, the rest of each image standing. Journalled as the stop is, so a restore does not
 * bring back a change confirmed in its waiting time to take effect. Nothing is mailed. Acts on the change the id names
 * alone, so a page showing a change since replaced discards nothing.
 *
 * Refused as the start is about who asks (`own_address`, `admin_address`), and where the change ended
 * (`address_change_ended`); 404 for an id naming no change.
 * @summary Discard a pending address change
 */
export const addressChangeDeleteAddressChangePathAddressChangeIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangeDeleteAddressChangeParams = zod.object({
  address_change_id: zod.string().regex(addressChangeDeleteAddressChangePathAddressChangeIdRegExp),
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
 * Refused where the change asks no approval or was given it (`address_change_no_approval_open`), where its seven days have passed
 * (`link_expired`), to the changed address and to the administrator who started it (`address_change_approval_denied`), to anyone but an
 * owner, signed in since becoming one, where the grant is an owner's (`address_change_approval_owner`), and where the change ended
 * (`address_change_ended`); and, where it would take effect, as the confirmation is (`link_barred`, `address_change_replaced_barred`,
 * `address_change_taken`, `address_change_not_covered`, `address_change_new_granted`, `address_change_occupied`). A change whose address
 * has come to hold nothing to move ends discarded, its new address told it did not take effect, answering `address_change_nothing`. 404 for an
 * id naming no change. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as a grant's is.
 * @summary Approve the move of an administrator's access with their address change
 */
export const addressChangePostAddressChangeApprovalPathAddressChangeIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangePostAddressChangeApprovalParams = zod.object({
  address_change_id: zod.string().regex(addressChangePostAddressChangeApprovalPathAddressChangeIdRegExp),
});

/**
 * Owe the new mailbox a fresh link for the change this id names, in the same transaction.
 *
 * The previous link stops working once the fresh one is handed out; the deadline restarts now. The stop link stays, so
 * the address on file is mailed nothing again. A lapsed link is no refusal while the change stands, which is until the
 * next hourly pass ends it. Acts on the change the id names alone, so a page showing a change since replaced re-sends
 * nothing.
 *
 * Refused as the start is about who asks (`own_address`, `admin_address`), where the ban list holds the pending address
 * (`address_change_barred`), where another pupil has come to sign in on it (`address_change_taken`), where an entry has come to name it,
 * confirmed or not (`address_change_occupied`), where a grant's approval week has passed (`link_expired`), and where the change ended
 * (`address_change_ended`). 404 for an id naming no change, and unless the change waits on the new mailbox: one awaiting the address on
 * file's confirmation, or confirmed, has no link to re-send.
 * @summary Send a pending address a fresh link
 */
export const addressChangeInviteAddressChangePathAddressChangeIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangeInviteAddressChangeParams = zod.object({
  address_change_id: zod.string().regex(addressChangeInviteAddressChangePathAddressChangeIdRegExp),
});

/**
 * Ban an address from signing up. The address is hashed under the backend key; no row and no log line holds it but its notice's.
 *
 * Refused where the list already holds the address (`duplicate_key`), while no season is
 * running, there being nothing to count the ban's five seasons from (`ban_list_no_saison`), and
 * where the address is an administrator's (`ban_list_admin`). The ban covers the
 * fifth season after the one running now — the last one it covers is answered as
 * `barred_until_saison_id` — and it survives that person's erasure. Every grant notice still owed
 * that names the address loses it in the same transaction, and where `notify` is set the ban's
 * own notice is owed to it there too, the one mail a ban does not stop.
 *
 * `ban_reason` is served, mailed to the address and kept past that person's erasure.
 * @summary Ban an email address
 */
export const banListPostBanListEntryBodyBanReasonMax = 500;

export const banListPostBanListEntryBodyBanReasonRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const banListPostBanListEntryBodyEmailMax = 254;

export const BanListPostBanListEntryBody = zod.object({
  ban_reason: zod.string().min(1).max(banListPostBanListEntryBodyBanReasonMax).regex(banListPostBanListEntryBodyBanReasonRegExp),
  email: zod.string().max(banListPostBanListEntryBodyEmailMax),
  notify: zod.boolean(),
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
 * at `GET /action_log` for that period and enforced by nothing from the moment this answers.
 * @summary Lift a ban
 */
export const banListDeleteBanListEntryPathBanListEntryIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BanListDeleteBanListEntryParams = zod.object({
  ban_list_entry_id: zod.string().regex(banListDeleteBanListEntryPathBanListEntryIdRegExp),
});

/**
 * Store one school's application to play one season as submitted, and owe each contact person their confirmation mail.
 *
 * Everything the league decides -- `status`, `submitted_at`, `decision` and each consent's
 * scope, source and date -- is written here and never taken off the payload. One mail per person is owed in the
 * same transaction, a person holding two seats being sent one link for both: the Ansprechperson the receipt naming
 * who is still to answer, every other person their link. Each link is minted when its mail is handed out; no token
 * is answered.
 *
 * The `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * application it holds, stores none and owes nothing again. The same key over other details is refused
 * (`bewerbung_key_differing`).
 *
 * An address the ban list holds, on any seat, is refused (`bewerbung_address_barred`) on a first press. Two people sharing
 * an address or a number are refused on the later box (`bewerbung_kontakt_repeated`), the seat the Trainer also holds being
 * that one person.
 *
 * A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links of the season is owed nothing and nothing refuses the
 * press: its seat stands unmailed, with a null `sent_at`, for an administrator to send the link. The answer is the same
 * either way, so it tells a stranger nothing about the address.
 * @summary Submit a Bewerbung
 */
export const bewerbungenPostBewerbungBodyKaderExpectedSizeMax = 200;

export const bewerbungenPostBewerbungBodyKaderGoodSpielerMin = 0;
export const bewerbungenPostBewerbungBodyKaderGoodSpielerMax = 200;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonEmailMax = 254;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonFirstNameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonLastNameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonLastNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteAnsprechpersonPhoneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostBewerbungBodyKontakteStellvertretungEmailMax = 254;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungFirstNameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteStellvertretungLastNameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteStellvertretungLastNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteStellvertretungPhoneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostBewerbungBodyKontakteTrainerEmailMax = 254;

export const bewerbungenPostBewerbungBodyKontakteTrainerFirstNameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteTrainerFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteTrainerLastNameMax = 80;

export const bewerbungenPostBewerbungBodyKontakteTrainerLastNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostBewerbungBodyKontakteTrainerPhoneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostBewerbungBodySaisonIdMin = 4;
export const bewerbungenPostBewerbungBodySaisonIdMax = 4;

export const bewerbungenPostBewerbungBodySchuleOneAddressCityMax = 80;

export const bewerbungenPostBewerbungBodySchuleOneAddressDistrictMax = 80;

export const bewerbungenPostBewerbungBodySchuleOneAddressHouseNumberMax = 16;

export const bewerbungenPostBewerbungBodySchuleOneAddressHouseNumberRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const bewerbungenPostBewerbungBodySchuleOneAddressPostcodeMin = 5;
export const bewerbungenPostBewerbungBodySchuleOneAddressPostcodeMax = 5;

export const bewerbungenPostBewerbungBodySchuleOneAddressPostcodeRegExp = new RegExp("^[0-9]{5}$");
export const bewerbungenPostBewerbungBodySchuleOneAddressStreetMax = 120;

export const bewerbungenPostBewerbungBodySchuleOneFullNameMax = 120;

export const bewerbungenPostBewerbungBodySchuleOneFullNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const bewerbungenPostBewerbungBodySchuleOneTeamNameMax = 60;

export const bewerbungenPostBewerbungBodySchuleOneTeamNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const bewerbungenPostBewerbungBodySchuleOneWebsiteUrlOneMax = 300;

export const bewerbungenPostBewerbungBodyStufengroesseMax = 999;

export const bewerbungenPostBewerbungBodyTeamIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const bewerbungenPostBewerbungBodyTrikotExistingSetMax = 500;

export const bewerbungenPostBewerbungBodyWunschgegnerOneMax = 120;

export const bewerbungenPostBewerbungBodyWunschgegnerOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const BewerbungenPostBewerbungBody = zod
  .object({
    kader: zod.object({
      expected_size: zod.int().min(1).max(bewerbungenPostBewerbungBodyKaderExpectedSizeMax),
      good_spieler: zod.int().min(bewerbungenPostBewerbungBodyKaderGoodSpielerMin).max(bewerbungenPostBewerbungBodyKaderGoodSpielerMax),
    }),
    kontakte: zod
      .object({
        ansprechperson: zod
          .object({
            email: zod.string().max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonEmailMax),
            first_name: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonFirstNameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteAnsprechpersonFirstNameRegExp),
            last_name: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteAnsprechpersonLastNameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteAnsprechpersonLastNameRegExp),
            phone: zod.string().regex(bewerbungenPostBewerbungBodyKontakteAnsprechpersonPhoneRegExp),
          })
          .describe("One of the three people, as a member of the public submits them, without a birthdate."),
        stellvertretung: zod
          .object({
            email: zod.string().max(bewerbungenPostBewerbungBodyKontakteStellvertretungEmailMax),
            first_name: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteStellvertretungFirstNameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteStellvertretungFirstNameRegExp),
            last_name: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteStellvertretungLastNameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteStellvertretungLastNameRegExp),
            phone: zod.string().regex(bewerbungenPostBewerbungBodyKontakteStellvertretungPhoneRegExp),
          })
          .describe("One of the three people, as a member of the public submits them, without a birthdate."),
        trainer: zod
          .object({
            email: zod.string().max(bewerbungenPostBewerbungBodyKontakteTrainerEmailMax),
            first_name: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteTrainerFirstNameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteTrainerFirstNameRegExp),
            last_name: zod
              .string()
              .min(1)
              .max(bewerbungenPostBewerbungBodyKontakteTrainerLastNameMax)
              .regex(bewerbungenPostBewerbungBodyKontakteTrainerLastNameRegExp),
            phone: zod.string().regex(bewerbungenPostBewerbungBodyKontakteTrainerPhoneRegExp),
          })
          .describe("One of the three people, as a member of the public submits them, without a birthdate."),
        trainer_is_also: zod.union([zod.enum(["ansprechperson", "stellvertretung"]), zod.null()]),
      })
      .describe("The three people an application is reached through, all three required."),
    saison_id: zod.string().min(bewerbungenPostBewerbungBodySaisonIdMin).max(bewerbungenPostBewerbungBodySaisonIdMax),
    schule: zod.union([
      zod
        .object({
          address: zod
            .object({
              city: zod.string().min(1).max(bewerbungenPostBewerbungBodySchuleOneAddressCityMax),
              district: zod.string().min(1).max(bewerbungenPostBewerbungBodySchuleOneAddressDistrictMax),
              house_number: zod
                .string()
                .max(bewerbungenPostBewerbungBodySchuleOneAddressHouseNumberMax)
                .regex(bewerbungenPostBewerbungBodySchuleOneAddressHouseNumberRegExp),
              postcode: zod
                .string()
                .min(bewerbungenPostBewerbungBodySchuleOneAddressPostcodeMin)
                .max(bewerbungenPostBewerbungBodySchuleOneAddressPostcodeMax)
                .regex(bewerbungenPostBewerbungBodySchuleOneAddressPostcodeRegExp),
              street: zod.string().min(1).max(bewerbungenPostBewerbungBodySchuleOneAddressStreetMax),
            })
            .describe("The school's address, with the district required."),
          full_name: zod
            .string()
            .min(1)
            .max(bewerbungenPostBewerbungBodySchuleOneFullNameMax)
            .regex(bewerbungenPostBewerbungBodySchuleOneFullNameRegExp),
          schulform: zod.enum(["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]),
          team_name: zod
            .string()
            .min(1)
            .max(bewerbungenPostBewerbungBodySchuleOneTeamNameMax)
            .regex(bewerbungenPostBewerbungBodySchuleOneTeamNameRegExp),
          website_url: zod.union([zod.string().max(bewerbungenPostBewerbungBodySchuleOneWebsiteUrlOneMax), zod.null()]),
        })
        .describe("The club a new school proposes, bounded and stripped for the write."),
      zod.null(),
    ]),
    stufengroesse: zod.int().min(1).max(bewerbungenPostBewerbungBodyStufengroesseMax),
    team_id: zod.union([zod.string().regex(bewerbungenPostBewerbungBodyTeamIdOneRegExp), zod.null()]),
    trikot: zod.object({
      existing_set: zod.string().max(bewerbungenPostBewerbungBodyTrikotExistingSetMax),
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
  .describe("One school's application, as the public form submits it.\n\n`status`, `submitted_at` and `decision` are the server's.");

/**
 * Record one person's consent or decline for the seat their link opens, and for a second seat they hold.
 *
 * A decline empties the slot; on an application it owes the Ansprechperson who still stands and was mailed the notice
 * naming who refused, in the same transaction, which stands as the deletion notice too. Refuses, writing nothing:
 * `link_invalid`, `link_expired`, `bewerbung_seat_already_answered`, `confirmation_age`, `link_barred`, `media_age`, and
 * on a team's season row `link_expired` and `kontakt_saison_past`.
 * @summary Confirm or decline one seat of a Bewerbung or of a team's season row
 */
export const bewerbungenPostEinwilligungBodyOneBirthDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const bewerbungenPostEinwilligungBodyOneTokenMax = 128;

export const bewerbungenPostEinwilligungBodyOneTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const bewerbungenPostEinwilligungBodyTwoTokenMax = 128;

export const bewerbungenPostEinwilligungBodyTwoTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const BewerbungenPostEinwilligungBody = zod.union([
  zod
    .object({
      answer: zod.literal("given").meta({ title: "Answer" }),
      birth_date: zod.string().regex(bewerbungenPostEinwilligungBodyOneBirthDateRegExp),
      media: zod.boolean(),
      text_versions: zod
        .object({
          media: zod.literal("2026-11-medien-1"),
          scope: zod.literal("2026-11-whatsapp-1"),
        })
        .describe("A contact seat's two wordings: the WhatsApp switch and the media switch."),
      token: zod.string().min(1).max(bewerbungenPostEinwilligungBodyOneTokenMax).regex(bewerbungenPostEinwilligungBodyOneTokenRegExp),
      whatsapp: zod.boolean(),
    })
    .describe("One person's consent for one seat: their own birthdate, their two choices and the wording they saw."),
  zod
    .object({
      answer: zod.literal("declined").meta({ title: "Answer" }),
      token: zod.string().min(1).max(bewerbungenPostEinwilligungBodyTwoTokenMax).regex(bewerbungenPostEinwilligungBodyTwoTokenRegExp),
    })
    .describe("One person's Widerspruch for one seat, which empties their slot: it carries nothing of them."),
]);

/**
 * What the confirmation page renders for the seat this token opens, and nothing of the person.
 *
 * A POST, so the token travels in the body. A confirmed, declined or expired link is served in that state, `barred`
 * ranking first; only a token no seat holds is refused (`link_invalid`).
 * @summary What one confirmation link opens
 */
export const bewerbungenGetEinwilligungViewBodyTokenMax = 128;

export const bewerbungenGetEinwilligungViewBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const BewerbungenGetEinwilligungViewBody = zod
  .object({
    token: zod.string().min(1).max(bewerbungenGetEinwilligungViewBodyTokenMax).regex(bewerbungenGetEinwilligungViewBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * One read for the form's page: the window, and while it runs the clubs a school may apply as and the colours taken.
 *
 * 404 only where no season carries the id. A closed or paused window and a season recording none are served, for the
 * page to say so; the clubs and the colours are served on a running window alone, each as a name or a colour and
 * nothing more (`READ-BEWERBUNG-001`).
 * @summary What one Saison's application form shows
 */
export const BewerbungenGetFormParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One read for the season's list and its bulk accept: its rows, newest first, and what an acceptance would meet.
 *
 * A row holds nothing of a person: a seat's count stands for it. 404 where no season carries the id, and `duplicate`
 * taken over every open application of the season. Degrades rather than refusing: the rows are written by an anonymous
 * public form, so a tripwire would hand whoever writes them the power to 500 this page, and `complete` reports the cut.
 * Every application with a confirmed seat is served past the newest rows a flood can fill: a flood naming strangers
 * confirms nothing, and a sender confirming one seat at a time has to hold each mailbox.
 * @summary One Saison's Bewerbungen for its list
 */
export const BewerbungenGetBewerbungenAdminQueryParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Run one season's seven retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.
 *
 * The drain sends what the pass owed. A row that cannot be written is passed over, counted in `failed` and met
 * again by the next pass. 404 where no season has the id.
 * @summary Run one season's retention clocks
 */
export const BewerbungenSweepSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One application, its decision's administrator withheld as the list withholds it.
 *
 * Each seat's `expired` says whether its own deadline has passed today, and `duplicate` is taken over every open
 * application of the season, as the list takes it.
 * @summary One Bewerbung for its review page
 */
export const bewerbungenGetBewerbungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenGetBewerbungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenGetBewerbungPathBewerbungIdRegExp),
});

/**
 * Accept an application, creating the school's club where the applicant proposed a new one, each call one transaction.
 *
 * The bulk accept is this endpoint once per card, so a refusal lands on its card and nothing already done is undone:
 * one request over a season's applications would outrun `app/core/middlewares.py :: REQUEST_DEADLINE_S`.
 *
 * IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
 * confirm their own seat (`bewerbung_kontakte_unconfirmed`), so every seat enters the season as its person confirmed it.
 * A new school takes its `shorthand` here, a taken one refused `duplicate_key` naming it; a picked club sends null.
 * A colour another row of the season holds is refused `trikot_farbe_taken` naming it; no colour stays free for any number.
 * The acceptance is owed to every person of the application in the same transaction, naming the seats each holds.
 * @summary Accept a Bewerbung and enter the school into the season
 */
export const bewerbungenAcceptBewerbungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenAcceptBewerbungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenAcceptBewerbungPathBewerbungIdRegExp),
});

export const bewerbungenAcceptBewerbungBodyShorthandOneRegExp = new RegExp("^\\s*[A-Za-z]{3}\\s*$");
export const bewerbungenAcceptBewerbungBodyVersionMin = 0;

export const BewerbungenAcceptBewerbungBody = zod
  .object({
    gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
    shorthand: zod.union([zod.string().regex(bewerbungenAcceptBewerbungBodyShorthandOneRegExp), zod.null()]),
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
    version: zod.int().min(bewerbungenAcceptBewerbungBodyVersionMin),
  })
  .describe("Which group the school enters, and the kit colour the league assigns it; the season is the application's own.");

/**
 * Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.
 *
 * A grant is refused. Refuses, writing nothing: `role_not_held`, `choices_stale` and
 * `giving_not_allowed`.
 * @summary Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung
 */
export const bewerbungenPatchEinwilligungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenPatchEinwilligungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenPatchEinwilligungPathBewerbungIdRegExp),
});

export const BewerbungenPatchEinwilligungBody = zod
  .object({
    evidence_state: zod.object({
      media: zod.union([zod.string(), zod.null()]),
      scope: zod.union([zod.string(), zod.null()]),
    }),
    media: zod.boolean(),
    scope: zod.enum(["kontakt_data", "kontakt_data_whatsapp"]),
    text_versions: zod
      .object({
        media: zod.literal("2026-11-medien-1"),
        scope: zod.literal("2026-11-whatsapp-1"),
      })
      .describe("A contact seat's two wordings: the WhatsApp switch and the media switch."),
  })
  .describe(
    "A seat holder's own two choices for every seat they hold on one row, under any label their kind cites.\n\nBoth choices on every press: a page that sent one alone would leave the other judged by nothing.",
  );

/**
 * Decline an application, recording who decided and the reason they gave, and owe each person it mailed the decline.
 *
 * The submission itself is untouched: a decline moves `status` and `decision` and nothing else,
 * so what the school wrote stays the record the decision was taken against. The mails carry the reason verbatim.
 * @summary Decline a Bewerbung
 */
export const bewerbungenDeclineBewerbungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenDeclineBewerbungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenDeclineBewerbungPathBewerbungIdRegExp),
});

export const bewerbungenDeclineBewerbungBodyReasonMax = 1000;

export const bewerbungenDeclineBewerbungBodyReasonRegExp = new RegExp("^[^\\x00\\v\\f\\u0085\\u2028\\u2029]*$");
export const bewerbungenDeclineBewerbungBodyVersionMin = 0;

export const BewerbungenDeclineBewerbungBody = zod
  .object({
    reason: zod.string().min(1).max(bewerbungenDeclineBewerbungBodyReasonMax).regex(bewerbungenDeclineBewerbungBodyReasonRegExp),
    version: zod.int().min(bewerbungenDeclineBewerbungBodyVersionMin),
  })
  .describe("Why the application was declined.");

/**
 * Void one seat's link and owe its person a fresh one in the same transaction; the old link then opens nothing.
 *
 * Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
 * The answer names the address and the seats as the write found them, so a seat write landing mid-request is where the link goes.
 * That seat's 14 days restart from today, no other seat's moving, and its reminder is owed again. The mirrored seat
 * is judged with the pressed one, a seat an erasure emptied is refused as an answered one is, and a
 * decision, an answer or an erasure landing while the request runs is refused too. A seat whose address the ban list
 * holds is refused `bewerbung_kontakt_barred`. A path naming no seat is a 404.
 * @summary Re-send one seat's confirmation link
 */
export const bewerbungenResendEinwilligungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenResendEinwilligungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenResendEinwilligungPathBewerbungIdRegExp),
  seat: zod.string(),
});

/**
 * „Sitz bearbeiten“: write the person into one seat and owe them their link in the same transaction.
 *
 * One write judged by the seat's state. A standing seat's person is replaced or their address corrected, a seat a
 * Widerspruch emptied is filled, and a confirmed seat's person gives way, the record written being administrative
 * and confirming nothing: the person's own link is what asks them, and an acceptance waits on that answer as it
 * waits on the other two. Where one person holds two seats both are written from one press and one link answers
 * both. The link the seat's last holder was sent opens nothing afterwards, and that seat's 14 days restart from today
 * EVEN WHERE THEY HAD PASSED: left where they were, the person would be handed a link that opens nothing.
 *
 * Refused on a stale `version` (`version_stale`), on an application already decided (`bewerbung_already_decided`), on
 * a seat erased at its person's request, the claimed mirror included (`bewerbung_seat_already_answered`), and on an
 * address or a number another contact person on this application already holds (`bewerbung_kontakt_email_taken`,
 * `bewerbung_kontakt_phone_taken`), or an address the ban list holds (`bewerbung_kontakt_barred`). A path naming no
 * seat is a 404.
 * @summary Write the person one contact seat holds and mail them a fresh link
 */
export const bewerbungenPostKontaktSeatPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenPostKontaktSeatParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenPostKontaktSeatPathBewerbungIdRegExp),
  seat: zod.string(),
});

export const bewerbungenPostKontaktSeatBodyEmailMax = 254;

export const bewerbungenPostKontaktSeatBodyFirstNameMax = 80;

export const bewerbungenPostKontaktSeatBodyFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostKontaktSeatBodyLastNameMax = 80;

export const bewerbungenPostKontaktSeatBodyLastNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const bewerbungenPostKontaktSeatBodyPhoneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const bewerbungenPostKontaktSeatBodyVersionMin = 0;

export const BewerbungenPostKontaktSeatBody = zod
  .object({
    email: zod.string().max(bewerbungenPostKontaktSeatBodyEmailMax),
    first_name: zod.string().min(1).max(bewerbungenPostKontaktSeatBodyFirstNameMax).regex(bewerbungenPostKontaktSeatBodyFirstNameRegExp),
    last_name: zod.string().min(1).max(bewerbungenPostKontaktSeatBodyLastNameMax).regex(bewerbungenPostKontaktSeatBodyLastNameRegExp),
    phone: zod.string().regex(bewerbungenPostKontaktSeatBodyPhoneRegExp),
    version: zod.int().min(bewerbungenPostKontaktSeatBodyVersionMin),
  })
  .describe("The person a seat is to hold, who has agreed to nothing yet, and the `version` the page read the application at.");

/**
 * Grant an address access to the administration, as `administration`, or ask another administrator to. No request grants `owner`.
 *
 * **Four eyes**: where another administrator could approve it -- a live, unbarred grant in effect now, neither this administrator
 * nor the address -- the grant is not made: a request is, answered with `requested` set and its id, and the grant takes effect
 * only on that approval (`POST /grants/approval_requests/{approval_request_id}/approval`). A lone administrator grants alone.
 *
 * The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
 * grant already holds the address (`grant_exists`), where the ban list
 * holds it (`grant_barred`), and where a request about it waits already (`grant_approval_request_open`). The grant takes effect on
 * the next request, for a session signed in after it alone -- an older one is refused `session_refused` on every admin-tier route -- and
 * its announcement is owed to every administrator in the same transaction. Like a revoke and a tier
 * change, it takes a passkey sign-in or confirmation no older than `ENROLMENT_WINDOW_MINUTES`, refused `confirmation_required` otherwise.
 * @summary Grant access to the administration
 */
export const grantsPostGrantBodyEmailMax = 254;

export const GrantsPostGrantBody = zod.object({
  email: zod.string().max(grantsPostGrantBodyEmailMax),
});

/**
 * Refuse a request, or withdraw one's own: it is removed, and nothing it asked for happens. HARD, no soft form.
 *
 * Decided by whoever may approve it, refused with the approval's own codes otherwise (`grant_approval_denied`,
 * `grant_approval_owner`, `grant_approval_younger`), and withdrawn by the administrator who made it, whatever their tier
 * now. 404 for an id naming no request, a request decided, withdrawn or lapsed among them. A restore from a snapshot taken before it brings
 * the request back only until the replay of its journal line.
 *
 * A refusal queues, in the same transaction, a notice to the request's requester naming the address and tier it asked for and
 * nobody who refused it, for `POST /grants/reconciliation` to hand out; a withdrawal tells nobody.
 * @summary Refuse a grant or a promotion another administrator asked for, or withdraw one's own
 */
export const grantsDeleteApprovalRequestPathApprovalRequestIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsDeleteApprovalRequestParams = zod.object({
  approval_request_id: zod.string().regex(grantsDeleteApprovalRequestPathApprovalRequestIdRegExp),
});

/**
 * Approve a request, the second pair of eyes a grant or a promotion waits on.
 *
 * The grant is made, or the tier moved, and the request removed, in one transaction, the change announced to every
 * administrator as one made directly is, under this administrator's name.
 *
 * Refused to the address the request is about and to the administrator who made it (`grant_approval_denied`), to anyone but an
 * owner, signed in since becoming one, for a promotion (`grant_approval_owner`), to an administrator whose grant, or owner's tier,
 * took effect after the request (`grant_approval_younger`), and where the requester does not hold that tier since before it,
 * revoked, demoted or barred since (`grant_approval_request_lapsed`); and, as the direct act would be, where the address holds a grant by now
 * (`grant_exists`) or is on the ban list (`grant_barred`). 404 for an id naming no request, a request decided, withdrawn or
 * lapsed among them, and for a promotion whose grant has gone. A promotion whose grant is an owner's already removes the request and changes
 * nothing. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as a grant's is.
 * @summary Approve a grant or a promotion another administrator asked for
 */
export const grantsPostApprovalRequestApprovalPathApprovalRequestIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsPostApprovalRequestApprovalParams = zod.object({
  approval_request_id: zod.string().regex(grantsPostApprovalRequestApprovalPathApprovalRequestIdRegExp),
});

/**
 * Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `actor_not_admin` on its next request.
 *
 * Only an `owner` revokes (`grant_only_owner`), judged on the actor's own grant inside the transaction, and before anything
 * about the target is answered; an owner's sign-in older than the moment they became one is refused the same. 404 where no grant
 * has the id. Refused for an `owner` row (`grant_owner`), which is made an
 * administrator first, and where fewer than two live, unbarred grants would remain (`grant_minimum_count`). The removal's
 * announcement is queued in the same transaction, after any change to the row made in the database and not yet announced. A sign-in
 * or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as the grant's is.
 * @summary Revoke access to the administration
 */
export const grantsDeleteGrantPathGrantIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsDeleteGrantParams = zod.object({
  grant_id: zod.string().regex(grantsDeleteGrantPathGrantIdRegExp),
});

/**
 * Make an administrator an owner, or an owner an administrator; an owner steps down by naming their own grant.
 *
 * Only an `owner` changes a tier (`grant_only_owner`), judged on the actor's own grant inside the transaction, and before
 * anything about the target is answered; an owner's sign-in older than the moment they became one is refused the same.
 *
 * **Four eyes on a promotion**: where another owner could approve it -- a live, unbarred `owner` grant in effect now, neither this
 * owner nor the promoted address -- the tier is not moved: a request is, answered with `requested` set, and the promotion takes
 * effect only on that approval (`POST /grants/approval_requests/{approval_request_id}/approval`). A lone owner promotes alone. A demotion
 * and a step-down take effect at once.
 *
 * A promotion holds for a sign-in after it alone: the promoted administrator's older sessions keep administering and take no owner's
 * step until they sign in again. A demotion takes the tier from every session at once. 404 where no live grant has the id. A
 * promotion of an address on the ban list is refused (`grant_barred`), one whose request waits already
 * (`grant_approval_request_open`), and a demotion leaving no live, unbarred owner (`grant_last_owner`). Naming the tier the grant
 * holds changes nothing and answers 200. The change reaches the next request; its announcement is queued in the same transaction, after
 * any change to the row made in the database and not yet announced, and a grant found that way is stamped `found_at` as
 * `POST /grants/reconciliation` stamps one. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused
 * `confirmation_required`, as the grant's is.
 * @summary Change a grant between administrator and owner
 */
export const grantsPatchGrantPathGrantIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsPatchGrantParams = zod.object({
  grant_id: zod.string().regex(grantsPatchGrantPathGrantIdRegExp),
});

export const GrantsPatchGrantBody = zod.object({
  admin_tier: zod.enum(["owner", "administration"]),
  version: zod.union([zod.int(), zod.null()]).optional(),
});

/**
 * Erase every record an address holds, on a request that person made by mail, at once and as one write, and answer how many of each kind went.
 *
 * ADMIN TIER, a step-up write. It runs the erasure `POST /identity/account/erasure` runs and refuses nothing about the
 * person's own state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass.
 * Three refusals are about who asks. The administrator's own address is refused (`own_address`): their account page
 * serves it, or an owner. An address holding a live grant is refused unless the administrator holds an owner's power,
 * signed in since becoming one (`admin_address`), judged inside the write: erasing it removes the grant, whatever grants
 * remain, so it asks what a revoke asks, an owner's power and a sign-in `ENROLMENT_WINDOW_MINUTES` old at most. Every
 * other address is erased from a sign-in inside the step-up window. Either window missed answers `confirmation_required`. An
 * address another address's pending change would move to is refused, judged inside the write, where that address holds a
 * live grant and the administrator no owner's power (`foreign_address_change`): the erasure ends the change, a discard only an
 * owner makes of it. The refusal tells that administrator some change the preview withholds names the address.
 *
 * `reason` names the request the erasure answers, and every log row the erasure files carries it; no other row does.
 * No redaction reaches it, so it is refused 422 where it holds an address. The grant notice names this administrator
 * as ending the person's grant. An address holding nothing is answered with every count zero. The 404 and the 409
 * answer only a database changed by hand under the request. The sign-in account is not touched here: deleting it is
 * the caller's, once this has answered.
 * @summary Erase every record an address holds, on that person's request
 */
export const identityPostErasureBodyEmailMax = 254;

export const identityPostErasureBodyEmailRegExp = new RegExp("@");
export const identityPostErasureBodyReasonMax = 200;

export const identityPostErasureBodyReasonRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const IdentityPostErasureBody = zod
  .object({
    email: zod
      .string()
      .max(identityPostErasureBodyEmailMax)
      .regex(identityPostErasureBodyEmailRegExp)
      .describe("Its domain, after the last `@`, in ASCII alone, an international one in punycode; else `email_not_accepted`."),
    reason: zod.string().min(1).max(identityPostErasureBodyReasonMax).regex(identityPostErasureBodyReasonRegExp),
  })
  .describe("The mailbox, and the request the erasure answers, which every log row the erasure files keeps.");

/**
 * Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.
 *
 * The rule, read from the seasons' stored statuses at each call: a pupil is due once they hold no squad row, live or retired,
 * in the latest `past` season, in any season with a greater id or in the running one, and no registration still `submitted`
 * at their address, compared as the sign-in folds it. While no season is `past` nobody is due, and `completed_saison_id`
 * is null. A pupil holding no address is never due: nothing else erases by a name.
 *
 * Each pupil is deleted in a transaction of their own, which first judges them again: one who has gained a squad row or a
 * pending registration since this call read them, the two committing before that transaction writes included, or whom another
 * call deleted first, is counted `skipped` and left standing. A squad entry or a registration meeting that transaction's
 * writes waits for it to end: the entry then finds nobody, and the registration is stored for a pupil already gone.
 * Two calls at once therefore delete each pupil once. Deleted are
 * the pupil's own data alone: the pupil record, every squad row it holds and every registration at the address, a declined
 * one included, each with its log images; every log row they wrote as a pupil keeps a
 * fixed marker in their place. A contact seat, a referee record, a grant and anything else held at the same
 * address stand, and so do the log images naming them.
 *
 * **A pass is a run of calls, each handing the next the `after` the last answered**, the first naming none; it ends at the call
 * answering `after` null. A call reaches at most a fixed share of the due pupils after `after`, in `_id` order, and the pass
 * holds no state on the server. A pupil whose deletion fails, the database refusing it or anything else, is counted
 * `failed`, logged by id and passed, so a failing record holds back nobody behind it in the pass; it stays due, and
 * the next pass tries it again. Where the request's deadline cuts the call, it stops at that pupil, warns once, and answers
 * what it did; the rest stay due, and the pass goes on from the next call. `remaining` counts the pupils due after the
 * call, those it failed or passed over among them, so it is no stopping condition. No body: the call takes no season and no
 * limit.
 *
 * The 409 is published because the duplicate-key trace reaches the registry's insert of the pupils' sentinel and reads no
 * handler; this call counts that failure as any other and never answers it.
 * @summary Delete one share of the pupils the season-after rule makes due
 */
export const identitySweepErasureQueryAfterOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const IdentitySweepErasureQueryParams = zod.object({
  after: zod.union([zod.string().regex(identitySweepErasureQueryAfterOneRegExp), zod.null()]).optional(),
});

/**
 * Answer which of this address's records `POST /identity/erasure` would remove or empty, by kind, name and the ids a page links each by.
 *
 * ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot, so it names
 * every one of them, an unconfirmed seat, a retired row, a pupil's every squad row and a declined registration among them,
 * and no other. Another address's pending change to this address is named by its id, the change going and that address's
 * records standing, beside why the address tool refuses that change this administrator, or null where it opens it; a change
 * of an address holding a grant is left out for an administrator without an owner's power, as the administrators page
 * withholds it, since naming it would answer whether a typed address is its new one. The address's own live change is
 * named by its id, ending with the records it would move. Every request for a grant about the address (`target`) or
 * made by it (`requester`) is named by its id and the tier it asks; a lapsed one is gone to every reader already and is
 * left out, though the erasure removes its row too. A squad
 * row and a referee row each carry the day it was retired, null while live, and a referee row every season holding a
 * fixture still to be played that it is booked on, as `schiedsrichter_still_assigned` judges one. Reached and not named: the fixtures
 * booking a referee row, which move onto the ghost, and the referee's name in each of those fixtures' log images, which
 * goes; the match reports a referee row sent, which stand naming the ghost, in
 * their log images too; the confirmations a referee row was asked for, which go, and its id
 * and reason in a removed season's log images; the links its contact seats were mailed on their teams' open match
 * confirmations, which stop answering; every reason typed from the address answering a match confirmation, from any seat,
 * which goes from its row and its log images, the answer standing; the grants, bans, invitations and decisions the address made for
 * others, which name a marker in its place; its rows in the log; every log image of a record the
 * erasure removes, emptied whole whether or not it holds the address, and every other log image holding the address;
 * a dead spelling of its grant, which admits nobody, each grant's announced row, and an announced row holding the
 * address under another grant's id; and the address in every notice still queued, withheld. Written besides: the
 * notice that the address's grant ended, which every administrator is sent. No address and no birthdate is answered.
 * `admin_tier` is the tier of the live grant the address holds, or null. `barred` is whether a standing ban holds the
 * address, judged as a stored address is; the erasure leaves a ban standing. Stores nothing.
 *
 * Refused as the erasure is: the administrator's own address (`own_address`), an address holding a live grant unless
 * the administrator holds an owner's power (`admin_address`).
 * @summary Show what an erasure of an address would remove
 */
export const identityGetErasureViewBodyEmailMax = 254;

export const identityGetErasureViewBodyEmailRegExp = new RegExp("@");

export const IdentityGetErasureViewBody = zod
  .object({
    email: zod
      .string()
      .max(identityGetErasureViewBodyEmailMax)
      .regex(identityGetErasureViewBodyEmailRegExp)
      .describe("Its domain, after the last `@`, in ASCII alone, an international one in punycode; else `email_not_accepted`."),
  })
  .describe("The mailbox an erasure, its preview or a sign-out of every session is looked up by.");

/**
 * Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.
 *
 * The whole batch is refused while no live grant is an owner's, since such a database would call every address unreferenced.
 * @summary Say which of these sign-in addresses no record references
 */
export const identityGetReferencesBodyIdentifiersMax = 250;

export const IdentityGetReferencesBody = zod
  .object({
    identifiers: zod.array(zod.string()).min(1).max(identityGetReferencesBodyIdentifiersMax),
  })
  .describe("The sign-in addresses a pass of the account sweep asks about.");

/**
 * Answer what the sign-in gate decides on for one mailbox: two flags, its ban and its grant's tier, and never a record.
 *
 * The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with both flags false.
 * @summary Say whether one mailbox may be offered a sign-in
 */
export const identityGetSignInBodyEmailMax = 254;

export const IdentityGetSignInBody = zod
  .object({
    email: zod.string().max(identityGetSignInBodyEmailMax),
  })
  .describe("Which mailbox is asking, folded to the one spelling the join, the header and the log agree on.");

/**
 * File one log row saying that this administrator ended every session of an address, and when, before the caller ends them.
 *
 * ADMIN TIER, a step-up write. The sessions live in the sign-in store, which the caller holds and this backend does not, so
 * the row is the whole of what this writes: collection `anmeldungen`, operation `delete_many`, the administrator as actor,
 * and no address, filter, image or count. Nothing bars the address and nothing is mailed; a person signs in again as before.
 *
 * Refused so that a refused call ends no session: from a sign-in older than the step-up window (`confirmation_required`), the
 * administrator's own address (`own_address`), an address holding an `owner` grant unless the administrator holds an
 * owner's power (`admin_address`). Unlike the erasure, it
 * ends another administrator's sessions for an administrator holding no owner's power: signing in again repairs it.
 * @summary Log the ending of every session an address holds
 */
export const identityPostSignOutBodyEmailMax = 254;

export const identityPostSignOutBodyEmailRegExp = new RegExp("@");

export const IdentityPostSignOutBody = zod
  .object({
    email: zod
      .string()
      .max(identityPostSignOutBodyEmailMax)
      .regex(identityPostSignOutBodyEmailRegExp)
      .describe("Its domain, after the last `@`, in ASCII alone, an international one in punycode; else `email_not_accepted`."),
  })
  .describe("The mailbox an erasure, its preview or a sign-out of every session is looked up by.");

/**
 * Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its ban and its grant.
 *
 * The address is matched on the sign-in fold, and a mailbox the league holds nothing for is answered with three empty lists rather
 * than a 404.
 * @summary Say which league records one mailbox holds
 */
export const identityGetSubjectBodyEmailMax = 254;

export const IdentityGetSubjectBody = zod
  .object({
    email: zod.string().max(identityGetSubjectBodyEmailMax),
  })
  .describe("Which mailbox is asking, folded to the one spelling the join, the header and the log agree on.");

/**
 * Record what the mail provider reported about one message, on the row of the mail it was.
 *
 * The row is the one `id` names, which the send carried as a tag, so an event arriving before the send's report finds
 * it all the same. Applied only where the row's delivery state is one the event's may follow -- a delay before
 * anything, a complaint after a delivery, nothing after a refusal -- so a redelivery or an event arriving after a later
 * one changes nothing. Both answer `applied: false`, as does an id no row has, rather than a refusal the provider
 * would retry for hours. A delivery applied to a mail about an application opens the closed chase of every seat holding
 * its address, in the same transaction.
 * @summary Record one delivery event on its mail's row
 */
export const outboxPostEventBodyIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const outboxPostEventBodyReasonOneMax = 128;

export const outboxPostEventBodyReasonOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const OutboxPostEventBody = zod
  .object({
    at: zod.iso.datetime({ offset: true }),
    id: zod.string().regex(outboxPostEventBodyIdRegExp),
    reason: zod.union([zod.string().max(outboxPostEventBodyReasonOneMax).regex(outboxPostEventBodyReasonOneRegExp), zod.null()]),
    state: zod.enum(["delivered", "delayed", "undeliverable", "suppressed", "complaint"]),
  })
  .describe("One delivery event about a message the provider accepted, named by the row the message was sent from.");

/**
 * Settle the named mail, where the named claim still holds it, by the outcome of its send, and nothing else.
 *
 * `sent` records the provider's message id; `held` a deployment that sends no mail; `abandon` a
 * refusal every send would meet, any 4xx but a 429. A failed send's `delivery_reason`, the provider's own name for the refusal,
 * is recorded on the row, the send's one record of why. `retry`, for a 429, a 5xx or a send that never reached the
 * provider, hands the mail back for a drain a minute from now, or gives it up where it has grown past its deadline; a
 * mail of the sign-in library is given up at once, its library's repair being a fresh one. A mail the claim does not
 * hold -- unknown, settled already, or claimed since by another drain after this claim lapsed -- is left alone and
 * counted in `ignored`; the answer counts one outcome. Each write names the claim, so its check and the outcome are
 * one atomic operation on one row, needing no transaction; a settled row keeps no facts and no secret.
 * @summary Settle one mail a claim handed out
 */
export const outboxPostResultBodyDeliveryReasonOneMax = 128;

export const outboxPostResultBodyDeliveryReasonOneRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const outboxPostResultBodyIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const outboxPostResultBodyMessageIdOneMax = 128;

export const OutboxPostResultBody = zod
  .object({
    delivery_reason: zod.union([
      zod.string().max(outboxPostResultBodyDeliveryReasonOneMax).regex(outboxPostResultBodyDeliveryReasonOneRegExp),
      zod.null(),
    ]),
    id: zod.string().regex(outboxPostResultBodyIdRegExp),
    lease: zod.string().min(1),
    message_id: zod.union([zod.string().min(1).max(outboxPostResultBodyMessageIdOneMax), zod.null()]),
    result: zod.enum(["sent", "retry", "abandon", "held"]),
  })
  .describe("The outcome of one handed-out mail's send, reported as the send returns.");

/**
 * Owe one mail the sign-in library sends -- the code, a passkey notice, the deletion link -- to the address named.
 *
 * Every call owes a mail of its own, under a key minted here: the library asks for each send once, and nothing repeats
 * the call. `secret` is stored as it arrives, encrypted under a key this service never holds, and dropped once the mail
 * is settled; `valid_until` is both the last moment a hand-out may send it and the moment the row is deleted, settled
 * or not.
 * @summary Owe one mail of the sign-in library
 */
export const outboxPostSignInBodyDataTwoAccountMax = 256;

export const outboxPostSignInBodyDataTwoAccountRegExp = new RegExp("^/[a-z0-9/_-]*$");
export const outboxPostSignInBodySecretOneMax = 4096;

export const outboxPostSignInBodyToMax = 254;

export const OutboxPostSignInBody = zod
  .object({
    data: zod.union([
      zod.object({
        kind: zod.literal("sign_in_code").meta({ title: "Kind" }),
      }),
      zod.object({
        account: zod.string().max(outboxPostSignInBodyDataTwoAccountMax).regex(outboxPostSignInBodyDataTwoAccountRegExp),
        instant: zod.iso.datetime({ offset: true }),
        kind: zod.enum(["passkey_added", "passkey_erased"]),
      }),
      zod.object({
        kind: zod.literal("account_erasure").meta({ title: "Kind" }),
      }),
    ]),
    secret: zod.union([zod.string().min(1).max(outboxPostSignInBodySecretOneMax), zod.null()]),
    to: zod.string().max(outboxPostSignInBodyToMax),
    valid_until: zod.union([zod.iso.datetime({ offset: true }), zod.null()]),
  })
  .describe("One mail of the sign-in library, owed to the address it names.");

/**
 * Store one pupil's registration for the team and season the link belongs to, and owe its confirmation mail.
 *
 * Everything the league decides -- the team, the season, `status`, `submitted_at` and the
 * deadline -- is taken off the invite and the clock and never off the payload. The mail is owed in
 * the Postausgang in the same transaction, its link minted when it is handed out; no token is answered.
 *
 * An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
 * registration it holds, stores none and owes no second mail. The same key over other details is refused
 * (`registrierung_key_differing`). A key whose registration the team has since admitted is refused too
 * (`registrierung_already_admitted`) and stores nothing: the pupil is in the squad.
 *
 * A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links of the season is owed nothing and nothing refuses
 * the press: the row stands unmailed and lapses on its deadline, and the answer is the same either way.
 * @summary Register through a team's link
 */
export const registrierungenPostRegistrierungBodyEmailMax = 254;

export const registrierungenPostRegistrierungBodyFirstNameMax = 80;

export const registrierungenPostRegistrierungBodyFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const registrierungenPostRegistrierungBodyLastNameMax = 80;

export const registrierungenPostRegistrierungBodyLastNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const registrierungenPostRegistrierungBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");
export const registrierungenPostRegistrierungBodyTokenMax = 128;

export const registrierungenPostRegistrierungBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const RegistrierungenPostRegistrierungBody = zod
  .object({
    email: zod.string().max(registrierungenPostRegistrierungBodyEmailMax),
    first_name: zod
      .string()
      .min(1)
      .max(registrierungenPostRegistrierungBodyFirstNameMax)
      .regex(registrierungenPostRegistrierungBodyFirstNameRegExp),
    last_name: zod
      .string()
      .min(1)
      .max(registrierungenPostRegistrierungBodyLastNameMax)
      .regex(registrierungenPostRegistrierungBodyLastNameRegExp),
    nummer: zod.union([zod.string().regex(registrierungenPostRegistrierungBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    token: zod.string().min(1).max(registrierungenPostRegistrierungBodyTokenMax).regex(registrierungenPostRegistrierungBodyTokenRegExp),
  })
  .describe(
    "One pupil registering through a team's link.\n\nThe team, the season, the state, the deadline and the confirmation link come from the invite and the clock, never from this body.",
  );

/**
 * Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.
 *
 * A grant is refused, and a PATCH moving neither writes nothing. Refuses, writing nothing: `role_not_held`,
 * `choices_stale` and `giving_not_allowed`.
 * @summary Withdraw a pupil's own publication and media consent on their pending registration
 */
export const registrierungenPatchEinwilligungPathRegistrierungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenPatchEinwilligungParams = zod.object({
  registrierung_id: zod.string().regex(registrierungenPatchEinwilligungPathRegistrierungIdRegExp),
});

export const RegistrierungenPatchEinwilligungBody = zod
  .object({
    evidence_state: zod.object({
      media: zod.union([zod.string(), zod.null()]),
      scope: zod.union([zod.string(), zod.null()]),
    }),
    media: zod.boolean(),
    scope: zod.enum(["kader_public", "internal"]),
    text_versions: zod
      .object({
        media: zod.literal("2026-11-medien-1"),
        scope: zod.literal("2026-11-name-kader-1"),
      })
      .describe("A pupil's two wordings: the name on the squad and the media switch."),
  })
  .describe("A pupil's or a registration's own two choices on their record.");

/**
 * Record a pupil's own answer for the registration their link opens, which stays pending until the team decides.
 *
 * Refuses, writing nothing: `link_invalid`, `link_expired`, its club having left the season among its cases,
 * `confirmation_exists`, `confirmation_age`, `media_age`, `link_barred` and `registrierung_choices_unsuitable`.
 * @summary Confirm one registration and record the pupil's consent
 */
export const registrierungenPostConfirmationBodyBirthDateOneRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const registrierungenPostConfirmationBodyBirthDateThreeRegExp = new RegExp("^\\s*$");
export const registrierungenPostConfirmationBodyTokenMax = 128;

export const registrierungenPostConfirmationBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const RegistrierungenPostConfirmationBody = zod
  .object({
    birth_date: zod.union([
      zod.string().regex(registrierungenPostConfirmationBodyBirthDateOneRegExp),
      zod.null(),
      zod.string().regex(registrierungenPostConfirmationBodyBirthDateThreeRegExp),
    ]),
    media: zod.union([zod.boolean(), zod.null()]),
    scope: zod.union([zod.enum(["kader_public", "internal"]), zod.null()]),
    text_versions: zod.union([
      zod
        .object({
          media: zod.literal("2026-11-medien-1"),
          scope: zod.literal("2026-11-name-kader-1"),
        })
        .describe("A pupil's two wordings: the name on the squad and the media switch."),
      zod.null(),
    ]),
    token: zod.string().min(1).max(registrierungenPostConfirmationBodyTokenMax).regex(registrierungenPostConfirmationBodyTokenRegExp),
  })
  .describe("One pupil's own answer: their date of birth where the page asks it, and on the new pupil's page the two consents.");

/**
 * What the confirmation page renders for the registration this token opens, and nothing of the pupil.
 *
 * A POST, so the token travels in the body. A confirmed or expired link is served in that state, `barred` ranking first,
 * a link whose club has left the season reading expired, and `confirmation_spieler_returning` opens the returning
 * pupil's page; only a token no registration holds is refused (`link_invalid`).
 * @summary What one registration confirmation link opens
 */
export const registrierungenGetConfirmationViewBodyTokenMax = 128;

export const registrierungenGetConfirmationViewBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const RegistrierungenGetConfirmationViewBody = zod
  .object({
    token: zod.string().min(1).max(registrierungenGetConfirmationViewBodyTokenMax).regex(registrierungenGetConfirmationViewBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * Answer what this registration link is for: the team, its school, the season, and what the form may offer.
 *
 * A POST because the link value travels in the body and never in a path the edge would log. A paused
 * or ended window is a STATE here rather than a refusal, so such a link reads as closed rather than as
 * invalid; only a link that opens no live invite, or whose team has left the season, is refused.
 * @summary What a registration link opens
 */
export const registrierungenPostInvitationViewBodyTokenMax = 128;

export const registrierungenPostInvitationViewBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const RegistrierungenPostInvitationViewBody = zod
  .object({
    token: zod.string().min(1).max(registrierungenPostInvitationViewBodyTokenMax).regex(registrierungenPostInvitationViewBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.
 *
 * A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
 * differs. An unconfirmed row names nobody: its address is unproven.
 * No address, telephone number, birthdate or consent record is served for anybody.
 * `complete` is false where more pending rows exist than `limit` serves.
 * @summary A team's pending registrations for one season
 */
export const registrierungenGetOpenRegistrierungenPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenGetOpenRegistrierungenParams = zod.object({
  team_id: zod.string().regex(registrierungenGetOpenRegistrierungenPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const registrierungenGetOpenRegistrierungenQueryLimitDefault = 1024;
export const registrierungenGetOpenRegistrierungenQueryLimitMax = 1024;

export const RegistrierungenGetOpenRegistrierungenQueryParams = zod.object({
  limit: zod
    .int()
    .min(1)
    .max(registrierungenGetOpenRegistrierungenQueryLimitMax)
    .default(registrierungenGetOpenRegistrierungenQueryLimitDefault),
  order: zod.enum(["asc", "desc"]).optional(),
});

/**
 * The Registrierungen page in one read: the season's pending rows, newest first, each named and with its club.
 *
 * The page narrows what the read holds; a declined row waits out its month and asks nothing of an administrator.
 * `confirmed` says whether the pupil answered their own link, `unmailed` whether the row was owed none, its mailbox past
 * `OPEN_LINKS_PER_MAILBOX`. 404 where no season holds that id. Degrades rather than
 * refusing, as `GET /bewerbungen/list/admin` does: the rows are written through a link anybody it reached can use, so a
 * tripwire would hand them the power to 500 this page, and `complete` reports the cut.
 * @summary One Saison's pending Registrierungen for its list
 */
export const registrierungenGetRegistrierungenAdminQueryLimitDefault = 1024;
export const registrierungenGetRegistrierungenAdminQueryLimitMax = 1024;

export const RegistrierungenGetRegistrierungenAdminQueryParams = zod.object({
  saison_id: zod.string(),
  limit: zod
    .int()
    .min(1)
    .max(registrierungenGetRegistrierungenAdminQueryLimitMax)
    .default(registrierungenGetRegistrierungenAdminQueryLimitDefault),
});

/**
 * Run the four registration retention clocks over one season, as of today in Europe/Berlin.
 *
 * A declined registration is erased a month after the decision. Once the season is `past`, every registration still awaiting a
 * decision is erased whatever the pupil answered, because no admission can be taken for a season that is over; the two clocks
 * below do not run for a `past` season, whose own end takes every row they read.
 *
 * Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
 * named that day. Then one reminder per registration at its reminder age whose club still holds the season, earliest deadline first:
 * `reminded_at` is stamped and the reminder owed in the Postausgang in one transaction, its link joining the one already in that
 * inbox. One call reminds a bounded share of the registrations due; the rest stay due and the calls after it remind them. Every
 * removal names this season alone and is made inside a transaction.
 *
 * A registration whose write fails, the database refusing it or anything else, is passed over alone and logged by id: the rest of
 * its clock's page or share goes, and it stays due, so the next pass meets it again and one failing record holds back no clock and
 * nobody behind it. `failed` sums the rows each of the four clocks passed over.
 *
 * 404 where no season has the id. Idempotent per day: a run after every due reminder is owed writes nothing.
 * @summary Run one season's registration retention clocks
 */
export const RegistrierungenSweepRegistrierungenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.
 *
 * The person survives the season, so the admission first looks for them: the stored person holding the
 * registration's address IS that person, and is updated with the registration's name and, where the new pupil's page
 * asked them, its birthdate and its freshly confirmed consent record: one confirmed on the returning pupil's page
 * leaves the person's own birthdate standing, as an administrator may have corrected it since. Where that person's
 * name or birthdate differs, `spieler_id` must name them (the team said it is the same person). With no such
 * person, `spieler_id` is null for a new one. A pending address change of theirs stands, asked over the address
 * this admission proves again.
 *
 * The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker judged on
 * the day the registration was submitted, never today's and never lifted from a retired row; this person's retired
 * row of this season is rewritten rather than a second one written, whichever team it was on. The registration is
 * deleted in the same transaction, so a second press meets no row. Its
 * submission key moves onto the squad row, so the submission replayed later stores nothing.
 *
 * Refuses, in this order: no pending registration with this id (404), no seat on its team's season
 * (`role_not_held`), a registration the pupil has not confirmed (`registrierung_unconfirmed`), an address the ban list
 * holds (`registrierung_address_barred`, worded to the team as neutrally as to the pupil), a Stufe the season does not offer
 * (`registrierung_stufe_not_allowed`), a registration confirmed on the returning pupil's page whose address holds no stored
 * person (`registrierung_person_missing`: it carries no choice, so it admits nobody, and the pupil registers again), a
 * `spieler_id` that is not the person this registration may be admitted into (`registrierung_person_not_named`), a person
 * already playing in a squad this season (`registrierung_already_in_kader`) and a full squad (`kader_full`). Nothing is
 * written on any of them.
 * @summary Admit a registration into the team's squad
 */
export const registrierungenAdmitPathRegistrierungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenAdmitParams = zod.object({
  registrierung_id: zod.string().regex(registrierungenAdmitPathRegistrierungIdRegExp),
});

export const registrierungenAdmitBodySpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenAdmitBody = zod
  .object({
    spieler_id: zod.union([zod.string().regex(registrierungenAdmitBodySpielerIdOneRegExp), zod.null()]),
  })
  .describe("The team's answer to the question the read asked: the person this registration is admitted into, or none.");

/**
 * Decline one pending registration, confirmed or not: its state and the decision are written, and the pupil's note owed.
 *
 * The decision records the declining seat holder's address and a reason from a closed set, never free text:
 * `other_person` where the team answered that the registration is not the person its address belongs to. The
 * row stays until the retention sweep erases it a month later. The note is owed in the same transaction, and only
 * where the pupil confirmed their address: an unconfirmed one may be a stranger's, typed by whoever held the link.
 *
 * Refuses, in this order, no pending registration with this id (404) and no seat on its team's season
 * (`role_not_held`).
 * @summary Decline a registration
 */
export const registrierungenDeclinePathRegistrierungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenDeclineParams = zod.object({
  registrierung_id: zod.string().regex(registrierungenDeclinePathRegistrierungIdRegExp),
});

export const RegistrierungenDeclineBody = zod
  .object({
    reason: zod.union([zod.literal("other_person"), zod.null()]),
  })
  .describe("Why the team declines, from a closed set or not at all.");

/**
 * Create the next season, always `future`, from its two days, answering the id it minted.
 *
 * The server names it: the year after the newest stored season's, or the league's first where none is stored, so a
 * season is never created out of turn. Its rules carry on from that newest season, or are the league's first season's
 * (`FIRST_SAISON_RULES`), and its two windows start closed, each set in the season's own editor. Refused while a
 * `future` season stands (`create_saison_future_stands`), so a league holds at most one planned season, the loser of
 * two creates at once included (`find_saison_create_refusal`); then by the rules it carries on and by its span against
 * them. Making the season live is a separate step.
 * @summary Create a Saison
 */
export const saisonsPostSaisonBodyEndDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyStartDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const SaisonsPostSaisonBody = zod.object({
  end_date: zod.string().regex(saisonsPostSaisonBodyEndDateRegExp),
  start_date: zod.string().regex(saisonsPostSaisonBodyStartDateRegExp),
});

/**
 * List every season, the `future` ones every base-tier read withholds included, each with its start, play and decision states.
 *
 * The admin surfaces read here because a season is created `future` and clubs are entered while it
 * still is, so an admin who cannot see one cannot run the league. `begun` is the start every
 * start lock refuses on, the swap's, the replacement's and the rules freeze's; `taken_place` is what
 * fixes the start date (`saison_start_taken_place`); `decided` is the landing's own rule, all four places of the Finale in.
 * `count_teams` counts every club row of the season, one that left included, and `count_spiele` its fixtures.
 * `next_saison_id` is the id the next create mints, and `refusals.create` the code that create would be refused with
 * now, by its own judgement, or null.
 * @summary Every Saison for the admin surfaces
 */
export const saisonsGetSaisonsAdminQueryLimitDefault = 1024;
export const saisonsGetSaisonsAdminQueryLimitMax = 1024;

export const saisonsGetSaisonsAdminQuerySortByDefault = `_id`;
export const saisonsGetSaisonsAdminQueryOrderDefault = `asc`;

export const SaisonsGetSaisonsAdminQueryParams = zod.object({
  status: zod.union([zod.enum(["past", "active", "future"]), zod.null()]).optional(),
  limit: zod.int().min(1).max(saisonsGetSaisonsAdminQueryLimitMax).default(saisonsGetSaisonsAdminQueryLimitDefault),
  sort_by: zod.enum(["_id", "start_date", "end_date"]).default(saisonsGetSaisonsAdminQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(saisonsGetSaisonsAdminQueryOrderDefault),
});

/**
 * One season the public may read, by its id.
 *
 * 404 where no season carries it or it is a `future` one.
 * @summary One Saison
 */
export const SaisonsGetSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Update a season's dates and rules on the `version` the editor was served, answering the version stored, which its next save sends.
 *
 * `status` is on no payload. Editing the points moves every league table on the NEXT READ, standings being derived. What a
 * started or drawn season has fixed is refused, as is a rule narrowed below what it holds. The start date moves until a
 * fixture of the season has taken place (`saison_start_taken_place`), and later only while no club's exit is stored
 * (`saison_start_austritt_stored`, its `latest` the stored start); the rules freeze reads the STORED start, so a season
 * started too early is unlocked by one save moving its start and a second changing its rules.
 * @summary Update a Saison's dates and rules
 */
export const SaisonsPatchSaisonParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsPatchSaisonBodyBewerbungOneEndRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyBewerbungOneStartRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyEndDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyRegistrierungOneEndRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const saisonsPatchSaisonBodyRulesDrawPointsMin = 0;

export const saisonsPatchSaisonBodyRulesForfeitErgebnisSiegerToreMin = 0;

export const saisonsPatchSaisonBodyRulesForfeitErgebnisVerliererToreMin = 0;

export const saisonsPatchSaisonBodyRulesLossPointsMin = 0;

export const saisonsPatchSaisonBodyRulesMaxKaderSizeExclusiveMin = 0;

export const saisonsPatchSaisonBodyRulesNumberOfGruppenExclusiveMin = 0;
export const saisonsPatchSaisonBodyRulesNumberOfGruppenMax = 16;

export const saisonsPatchSaisonBodyRulesQualifiersPerGruppeExclusiveMin = 0;

export const saisonsPatchSaisonBodyRulesTeamsPerGruppeMin = 2;
export const saisonsPatchSaisonBodyRulesTeamsPerGruppeMax = 16;

export const saisonsPatchSaisonBodyRulesWinPointsExclusiveMin = 0;

export const saisonsPatchSaisonBodyStartDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPatchSaisonBodyVersionMin = 0;

export const SaisonsPatchSaisonBody = zod.object({
  bewerbung: zod.union([
    zod
      .object({
        end: zod.string().regex(saisonsPatchSaisonBodyBewerbungOneEndRegExp),
        open: zod.boolean(),
        start: zod.string().regex(saisonsPatchSaisonBodyBewerbungOneStartRegExp),
      })
      .describe(
        "The application window as a season write sends it, judged apart from the season's own span: it may open before the season does.",
      ),
    zod.null(),
  ]),
  end_date: zod.string().regex(saisonsPatchSaisonBodyEndDateRegExp),
  registrierung: zod.union([
    zod
      .object({
        end: zod.string().regex(saisonsPatchSaisonBodyRegistrierungOneEndRegExp),
        open: zod.boolean(),
      })
      .describe(
        "When a pupil's entry is an ordinary one: from the season's activation to `end`, which falls before the season's start.\n\nNo start of its own, the activation being the opening (`app/api/registrierungen/services.py ::\nsaison_nimmt_registrierungen_an`). Past `end` the link runs on until the season ends and an entry is a nominee\n(`app/api/saisons/services.py :: entry_is_a_nominee`); `open` pauses the link alone. Its own model rather than an alias of\n`FLSaisonBewerbung` above: the two windows are two decisions an administrator takes apart.",
      ),
    zod.null(),
  ]),
  rules: zod.object({
    allowed_stufen: zod.array(zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"])).min(1),
    draw_points: zod.int().min(saisonsPatchSaisonBodyRulesDrawPointsMin),
    forfeit_ergebnis: zod
      .object({
        sieger_tore: zod.int().min(saisonsPatchSaisonBodyRulesForfeitErgebnisSiegerToreMin),
        verlierer_tore: zod.int().min(saisonsPatchSaisonBodyRulesForfeitErgebnisVerliererToreMin),
      })
      .describe(
        "What a fixture is awarded when one side does not appear.\n\nBoth sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.\nA LEVEL award needs a season with no knockout round (`rules_forfeit_unentschieden_in_a_knockout`).",
      ),
    loss_points: zod.int().min(saisonsPatchSaisonBodyRulesLossPointsMin),
    max_kader_size: zod.int().gt(saisonsPatchSaisonBodyRulesMaxKaderSizeExclusiveMin),
    number_of_gruppen: zod.int().gt(saisonsPatchSaisonBodyRulesNumberOfGruppenExclusiveMin).max(saisonsPatchSaisonBodyRulesNumberOfGruppenMax),
    qualifiers_per_gruppe: zod.int().gt(saisonsPatchSaisonBodyRulesQualifiersPerGruppeExclusiveMin),
    teams_per_gruppe: zod.int().min(saisonsPatchSaisonBodyRulesTeamsPerGruppeMin).max(saisonsPatchSaisonBodyRulesTeamsPerGruppeMax),
    tiebreak_order: zod.enum(["tordifferenz", "direkter_vergleich"]),
    win_points: zod.int().gt(saisonsPatchSaisonBodyRulesWinPointsExclusiveMin),
  }),
  start_date: zod.string().regex(saisonsPatchSaisonBodyStartDateRegExp),
  version: zod.int().min(saisonsPatchSaisonBodyVersionMin),
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
 * Return what the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.
 *
 * The season is served a `future` one included, with its `version`, whether it has started (`begun`), whether a
 * fixture of it has taken place (`taken_place`) and whether it is decided (`decided`), by the landing's own rule.
 *
 * Each club's two flags are what the group swap's `swap_sides_taken_place` and the replacement's
 * `replace_sides_taken_place` read, so a picker closes exactly the pairs and rows those writes refuse; `begun` closes
 * both before either is pressed. `incoming_teams` is every club still in the league holding no row of the season,
 * which is what the replacement admits.
 *
 * `refusals` names, per act, the refusal its write would answer now, by that write's own judgement, so the editor
 * offers an act exactly where the write takes it. `invitations` is the registration links' press planned by the function
 * the press decides each team by, `resend` left false, beside each team's live link and the day it was last sent.
 * Read outside a transaction: a write landing between this read and a press is judged by the press. 404 where no
 * season holds that id.
 * @summary One Saison for the admin editor
 */
export const SaisonsGetSaisonAdminParams = zod.object({
  saison_id: zod.string(),
});

/**
 * How many pupils `POST /identity/erasure/sweep` deletes once this season is activated, and which season that activation closes.
 *
 * Judged by the run's own rule over the statuses the activation leaves: the season now `active` turned `past`, this one
 * `active`, every other as it stands. A count and never a name, and writes nothing. It judges none of the activation's own
 * refusals, and the people it counts are those due at this moment: a squad row or a registration arriving before the run
 * keeps its pupil, and a pupil whose stored address no request matches is counted though the run passes them over.
 * `completed_saison_id` is null where no season but this one is `active`. 404 where no season holds that id.
 * @summary How many pupils activating this season would delete
 */
export const SaisonsGetErasurePreviewParams = zod.object({
  saison_id: zod.string(),
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
 * Give every admitted team of this season a fresh registration link and owe it to the team's confirmed seats, one mail each.
 *
 * **Every team mailed gets a fresh invite, and any link that team already held is REVOKED in the same per-team transaction** — the
 * copy in somebody's inbox opens nothing from that moment. The mails are owed in that transaction too, each minting its link when it is
 * handed out; no link is answered. A team this skips is left exactly as it was.
 *
 * Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that block
 * has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link was already sent and
 * `resend` is false. **The ban is read once ahead of every team**, so a team the mailer could reach nobody of keeps the link it
 * holds rather than losing it to a press that mails nobody. **The fifth is read off the day the live link was sent, stored on it**,
 * never off the Postausgang, whose row is erased a retention after it settles: pressing twice mails nobody twice, and a link a club
 * holds is replaced only by a deliberate resend. **The first is read off the junction row's
 * `austritt` record**, so a team out of the season by either route is passed over; minting for one team by hand is not refused, that
 * being a deliberate act rather than a bulk one.
 *
 * Refused where the season has ended (`saison_past`); 404 where no season holds that id; a season holding no team answers zero
 * counts.
 *
 * **An administrator whose access is revoked while the mailing runs is refused `actor_not_admin` at the next team**: every team done before
 * that point holds its fresh link and its mails, and running the mailing again, as an administrator who still holds access, skips those
 * teams and reaches the rest.
 * @summary Mint every admitted team a link
 */
export const SaisonsPostInvitationsDispatchParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsPostInvitationsDispatchBodyResendDefault = false;

export const SaisonsPostInvitationsDispatchBody = zod.object({
  resend: zod.boolean().default(saisonsPostInvitationsDispatchBodyResendDefault),
});

/**
 * Every knockout matchday of one season with its matches in playing order, a side not yet known null beside its `quelle`.
 *
 * Empty before the draw; 404 for a season this tier may not read.
 * @summary One Saison's K.-o.-Runde
 */
export const SaisonsGetKoRundeParams = zod.object({
  saison_id: zod.string(),
});

/**
 * The administrator's Übersicht for one season: its open work on four cards, every card served, an empty one included.
 *
 * In order: `due`, each fixture whose clubs owe their answer past its deadline or by today; `ergebnisse`, each fixture
 * played without a result, and each report not adopted as it stands; `dates`, each club's open date proposal, each
 * fixture lacking its date, time, venue, referee or, in the knockout stage, a side's club and source, each referee's own
 * decline while the slot stays empty, and each fault of the bracket or its bookings; `bewerbungen`, each undecided
 * application to play the season. A fixture called off or struck out lacks nothing. Each row carries what its act
 * needs: the fixture with its `version`, each open party's confirmation row, a proposal's row and its date and hour.
 * Answers 404 for a season that does not exist. Writes nothing.
 * @summary One Saison's open work, card by card
 */
export const SaisonsGetSaisonOverviewParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One match as its page and its pop-up show it, each side of a group match with its group and `platz`; 404 outside a readable season.
 *
 * Its report's line-ups whenever a club entered one, the scorers and cards only while the report is adopted and
 * unchanged since, every pupil through the public mask.
 * @summary One Spiel's page
 */
export const saisonsGetSpielPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SaisonsGetSpielParams = zod.object({
  saison_id: zod.string(),
  spiel_id: zod.string().regex(saisonsGetSpielPathSpielIdRegExp),
});

/**
 * Return the season to undrawn: matchdays, fixtures and watermark, in one transaction.
 *
 * Every fixture's confirmations go with it.
 *
 * The replace's window bounds it (`spielplan_undraw_outside_its_window`), and a submitted match report refuses it
 * (`spielplan_berichte_submitted`). Undoing the draw is what reopens the shape rules to `PATCH` and the groups to
 * an entry.
 * @summary Undraw this Saison's Spielplan
 */
export const SaisonsDeleteSpielplanParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Every matchday of one season with its matches, in playing order, and the matchday to open on.
 *
 * The Spielplan and the Spielsuche both show this. 404 for a season this tier may not read.
 * @summary One Saison's Spielplan
 */
export const SaisonsGetSpielplanParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Draw the whole season at once: every matchday and every fixture, undated, in one transaction.
 *
 * `shape` states the three rules the fixtures come out of, and is stored with them. `replace`
 * deletes both lists first, every fixture's confirmations with them, inside `spielplan_replace_outside_its_window`'s
 * window and on a season holding no submitted match report (`spielplan_berichte_submitted`): nothing writes the
 * removed rows back.
 * @summary Draw this Saison's Spielplan
 */
export const SaisonsPostSpielplanParams = zod.object({
  saison_id: zod.string(),
});

export const saisonsPostSpielplanBodyReplaceDefault = false;
export const saisonsPostSpielplanBodyShapeOneNumberOfGruppenExclusiveMin = 0;
export const saisonsPostSpielplanBodyShapeOneNumberOfGruppenMax = 16;

export const saisonsPostSpielplanBodyShapeOneQualifiersPerGruppeExclusiveMin = 0;

export const saisonsPostSpielplanBodyShapeOneTeamsPerGruppeMin = 2;
export const saisonsPostSpielplanBodyShapeOneTeamsPerGruppeMax = 16;

export const SaisonsPostSpielplanBody = zod
  .object({
    replace: zod.boolean().default(saisonsPostSpielplanBodyReplaceDefault),
    shape: zod
      .union([
        zod
          .object({
            number_of_gruppen: zod
              .int()
              .gt(saisonsPostSpielplanBodyShapeOneNumberOfGruppenExclusiveMin)
              .max(saisonsPostSpielplanBodyShapeOneNumberOfGruppenMax),
            qualifiers_per_gruppe: zod.int().gt(saisonsPostSpielplanBodyShapeOneQualifiersPerGruppeExclusiveMin),
            teams_per_gruppe: zod
              .int()
              .min(saisonsPostSpielplanBodyShapeOneTeamsPerGruppeMin)
              .max(saisonsPostSpielplanBodyShapeOneTeamsPerGruppeMax),
          })
          .describe(
            "The three rules a season's fixture list is a function of, as this draw is to run from.\n\nAll three or none: the draw is one function of the whole shape, and a payload naming half\nof it would take the rest off a season about to stop matching it.",
          ),
        zod.null(),
      ])
      .optional(),
  })
  .describe(
    "Whether this draw may REPLACE what the season already holds, and the shape it runs from.\n\nAn absent body is a first draw off the season's own rules: nothing is destroyed and no\nnumber moves by omission. `spielplan_replace_outside_its_window` bounds a confirmed one.",
  );

/**
 * Each group's standing over the group phase with its goals counted on every read, and how many of each group advance.
 *
 * A club that left the season keeps its row; it holds no `platz` where it left before its group was decided, and
 * neither does a club that has played no match, listed after every club that has; 404 for a season this tier may not
 * read.
 * @summary One Saison's Tabelle
 */
export const SaisonsGetTabelleParams = zod.object({
  saison_id: zod.string(),
});

/**
 * The clubs of one season by name, each under the name and shorthand it plays that season under.
 *
 * 404 for a season this tier may not read.
 * @summary One Saison's teams
 */
export const SaisonsGetTeamsParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One club in one season: the club, its row of the Tabelle, its matches and its squad.
 *
 * 404 for a season this tier may not read and for a club the season does not hold.
 * @summary One team's page in one Saison
 */
export const saisonsGetTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SaisonsGetTeamParams = zod.object({
  saison_id: zod.string(),
  team_id: zod.string().regex(saisonsGetTeamPathTeamIdRegExp),
});

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
 * Create a referee and owe them their confirmation link.
 *
 * `inactive_since` is set to null here and is on no payload. **Entering a referee IS the
 * invitation**: the payload requires an email address, and there is no second press deciding
 * whether this person is asked, because a referee nobody asked is a name nobody consented to
 * publish. The link goes out through the Postausgang, which mints it; the answer names the address and the deadline.
 *
 * Refused where another referee holds the name (`duplicate_key`, naming `name`), then
 * `schiedsrichter_address_barred` where the address given is on the ban list.
 * @summary Create a Schiedsrichter
 */
export const schiedsrichterPostSchiedsrichterBodyDefaultPaymentMin = 0;

export const schiedsrichterPostSchiedsrichterBodyKontaktEmailMax = 254;

export const schiedsrichterPostSchiedsrichterBodyKontaktPhoneOneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const schiedsrichterPostSchiedsrichterBodyKontaktPhoneThreeRegExp = new RegExp("^\\s*$");
export const schiedsrichterPostSchiedsrichterBodyNameMax = 80;

export const schiedsrichterPostSchiedsrichterBodyNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const schiedsrichterPostSchiedsrichterBodySchuleOneMax = 120;

export const SchiedsrichterPostSchiedsrichterBody = zod.object({
  default_payment: zod.int().min(schiedsrichterPostSchiedsrichterBodyDefaultPaymentMin),
  kontakt: zod.object({
    email: zod.string().max(schiedsrichterPostSchiedsrichterBodyKontaktEmailMax),
    phone: zod.union([
      zod.string().regex(schiedsrichterPostSchiedsrichterBodyKontaktPhoneOneRegExp),
      zod.null(),
      zod.string().regex(schiedsrichterPostSchiedsrichterBodyKontaktPhoneThreeRegExp),
    ]),
  }),
  name: zod.string().min(1).max(schiedsrichterPostSchiedsrichterBodyNameMax).regex(schiedsrichterPostSchiedsrichterBodyNameRegExp),
  schule: zod.union([zod.string().max(schiedsrichterPostSchiedsrichterBodySchuleOneMax), zod.null()]),
});

/**
 * Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.
 *
 * Writes those two on this one referee row, each moved choice with its evidence (`evidence.<choice>`), and nothing
 * else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
 * public fixture list reads the scope off this row, so a withdrawal takes the name off every fixture page at that
 * list's next read. A PATCH moving neither choice writes nothing. A GRANT (`scope` to
 * `kader_public` or `media` to `true`) is taken on a live record alone; a withdrawal on a retired one too.
 *
 * Refuses, in this order: an id that is no confirmed referee record of this address (`role_not_held`); a
 * `evidence_state` other than the record's own, either choice having moved since the page was served
 * (`choices_stale`); a grant on a retired record (`giving_not_allowed`); a choice moving onto a grant under a label
 * other than its current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to
 * `true` where the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
 * refusal writes nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this row; nothing here can.
 * @summary Change a signed-in referee's own publication and media consent
 */
export const schiedsrichterPatchEinwilligungPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterPatchEinwilligungParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterPatchEinwilligungPathSchiedsrichterIdRegExp),
});

export const SchiedsrichterPatchEinwilligungBody = zod
  .object({
    evidence_state: zod.object({
      media: zod.union([zod.string(), zod.null()]),
      scope: zod.union([zod.string(), zod.null()]),
    }),
    media: zod.boolean(),
    scope: zod.enum(["kader_public", "internal"]),
    text_versions: zod
      .object({
        media: zod.literal("2026-11-medien-1"),
        scope: zod.literal("2026-11-name-spielplan-1"),
      })
      .describe("A referee's two wordings: the name on the fixtures and the media switch."),
  })
  .describe("A referee's own two choices on their record.");

/**
 * Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.
 *
 * The consent carries the publication scope they chose, the media answer beside it, the stamp and, on each choice's
 * evidence, the wording they were shown. It reaches this one collection and writes nothing on any fixture: a referee's
 * publication scope has one home, which the fixture list joins at read time to decide whether to publish the name each
 * fixture stores.
 *
 * Refuses, in this order: a token no referee holds (`link_invalid`), an entry already answered, confirmed or
 * declined (`confirmation_exists`), a link whose deadline has passed (`link_expired`), a link mailed to an address the ban
 * list holds now, whenever the link was minted (`link_barred`), an age outside `minimum_age` to `maximum_age`
 * (`confirmation_age`, carrying the two as its bounds `min` and `max`), and a media consent from a referee below
 * `media_minimum_age` (`media_age`) -- the last two judged before anything is written, so a mistyped year spends nothing.
 *
 * **The caller drops the cached fixture list after a successful answer**, which reads this record. Nothing here can:
 * a withheld name would go on being served for as long as that entry lives.
 * @summary Confirm one Schiedsrichter's entry and consent
 */
export const schiedsrichterPostConfirmationBodyBirthDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const schiedsrichterPostConfirmationBodyTokenMax = 128;

export const schiedsrichterPostConfirmationBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SchiedsrichterPostConfirmationBody = zod.object({
  birth_date: zod.string().regex(schiedsrichterPostConfirmationBodyBirthDateRegExp),
  media: zod.boolean(),
  scope: zod.enum(["kader_public", "internal"]),
  text_versions: zod
    .object({
      media: zod.literal("2026-11-medien-1"),
      scope: zod.literal("2026-11-name-spielplan-1"),
    })
    .describe("A referee's two wordings: the name on the fixtures and the media switch."),
  token: zod.string().min(1).max(schiedsrichterPostConfirmationBodyTokenMax).regex(schiedsrichterPostConfirmationBodyTokenRegExp),
});

/**
 * Record the referee's objection to the entry their link opens: its day, and nothing else of the person.
 *
 * The entry then goes on the clock its link started, the midnight after the deadline, as the privacy notice says of an
 * unconfirmed or declined one (`POST /schiedsrichter/sweep`). Until then no booking takes it and no
 * re-send or reactivation asks the person again. Every log image of the entry is redacted at the press, as a contact's
 * objection redacts theirs, and the objection is journalled, so a restore from a snapshot taken before it replays it.
 *
 * Refuses, in the confirmation's order: a token no referee holds (`link_invalid`), an entry already answered,
 * confirmed or declined (`confirmation_exists`), and a link whose deadline has passed (`link_expired`). The ban list
 * is not asked: an objection gives the league nothing a ban withholds.
 * @summary Decline one Schiedsrichter's entry
 */
export const schiedsrichterPostDeclineBodyTokenMax = 128;

export const schiedsrichterPostDeclineBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SchiedsrichterPostDeclineBody = zod
  .object({
    token: zod.string().min(1).max(schiedsrichterPostDeclineBodyTokenMax).regex(schiedsrichterPostDeclineBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * Answer what this token opens: the link's state and deadline, the age bounds, and the day of the person's own answer.
 *
 * **Nothing else** (`READ-REFEREE-002`): never a name, the school, the contact details, the fee, the birthdate or the
 * entry's id, all of which are behind `READ-CONTACT-001`. The link went to an address an administrator typed and nobody has
 * confirmed, which behind a typo is a stranger's. A POST that reads, so the token travels in a body and never in a second
 * URL.
 *
 * Refuses only a token no referee holds (`link_invalid`): a confirmed or an expired link
 * is SERVED in that state rather than refused, so a reopened link shows what became of it. The state is `barred`,
 * ahead of every other, wherever the ban list holds the address the link was mailed to (`link_barred`),
 * so the page offers a barred referee nothing to press. `answered_at` is the day the state's answer was given, the
 * consent's or the objection's, and null on every state showing none.
 * @summary What one Schiedsrichter confirmation link opens
 */
export const schiedsrichterGetConfirmationViewBodyTokenMax = 128;

export const schiedsrichterGetConfirmationViewBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SchiedsrichterGetConfirmationViewBody = zod
  .object({
    token: zod.string().min(1).max(schiedsrichterGetConfirmationViewBodyTokenMax).regex(schiedsrichterGetConfirmationViewBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * Deactivate a referee. SOFT, for the same reason as venues: a played match names them by id.
 *
 * Refused while an unplayed fixture still books them (`schiedsrichter_still_assigned`), naming the path's id with
 * those fixtures' `spiel_nrs` and their `count` as its bounds.
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
 * beside why the tool refuses it this administrator, null where it opens it. `delivery` says what became of the last
 * confirmation mail the referee was owed, null where none was.
 * @summary One Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichterByIdPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterGetSchiedsrichterByIdParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterGetSchiedsrichterByIdPathSchiedsrichterIdRegExp),
});

/**
 * Update a referee on the `version` the editor was served, answering the version stored.
 *
 * The editor's next save sends that version. A fixture names the referee by id and reads the name at its own read, so
 * nothing else is written; each fixture keeps the `payment` agreed for it.
 *
 * **A corrected address on an UNCONFIRMED referee retires their link and owes a fresh one** to the
 * new address, named in `confirmation`: the old link was posted to a mailbox nobody reads, and
 * leaving it live is a credential in the wrong inbox.
 *
 * **A CONFIRMED referee's address is refused here** (`schiedsrichter_address_only_per_change`), retired or not: it is who signs in as the
 * person, and moves only through an address change: the address tool, `POST /address_change`, or the person's own account page.
 * A save keeping it lands, a pending change standing.
 *
 * **A RETIRED unconfirmed referee's corrected address is stored and mails nothing**: no consent is
 * collected for a role nobody gives them. Their old link is retired all the same, and the
 * reactivation mints the fresh one. Where a link is minted, a banned new address is refused
 * `schiedsrichter_address_barred`.
 *
 * Refused where another referee holds the name (`duplicate_key`, naming `name`), ahead of the address's refusals.
 *
 * The ghost answers 404 here as it does to every read: a name written onto it would appear on the
 * fixtures of every referee already erased.
 * @summary Update a Schiedsrichter
 */
export const schiedsrichterPatchSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterPatchSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterPatchSchiedsrichterPathSchiedsrichterIdRegExp),
});

export const schiedsrichterPatchSchiedsrichterBodyDefaultPaymentMin = 0;

export const schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax = 254;

export const schiedsrichterPatchSchiedsrichterBodyKontaktPhoneOneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const schiedsrichterPatchSchiedsrichterBodyKontaktPhoneThreeRegExp = new RegExp("^\\s*$");
export const schiedsrichterPatchSchiedsrichterBodyNameMax = 80;

export const schiedsrichterPatchSchiedsrichterBodyNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const schiedsrichterPatchSchiedsrichterBodySchuleOneMax = 120;

export const schiedsrichterPatchSchiedsrichterBodyVersionMin = 0;

export const SchiedsrichterPatchSchiedsrichterBody = zod.object({
  default_payment: zod.int().min(schiedsrichterPatchSchiedsrichterBodyDefaultPaymentMin),
  kontakt: zod.object({
    email: zod.string().max(schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax),
    phone: zod.union([
      zod.string().regex(schiedsrichterPatchSchiedsrichterBodyKontaktPhoneOneRegExp),
      zod.null(),
      zod.string().regex(schiedsrichterPatchSchiedsrichterBodyKontaktPhoneThreeRegExp),
    ]),
  }),
  name: zod.string().min(1).max(schiedsrichterPatchSchiedsrichterBodyNameMax).regex(schiedsrichterPatchSchiedsrichterBodyNameRegExp),
  schule: zod.union([zod.string().max(schiedsrichterPatchSchiedsrichterBodySchuleOneMax), zod.null()]),
  version: zod.int().min(schiedsrichterPatchSchiedsrichterBodyVersionMin),
});

/**
 * Owe this referee a fresh confirmation link, which the Postausgang mints and mails, and answer where it goes.
 *
 * It replaces the whole block, so the previous link stops working at once. The deadline restarts from today.
 *
 * Refused where the referee is retired (`schiedsrichter_retired`), where they have already
 * answered, consenting or objecting (`confirmation_exists`), where they carry no email address
 * (`schiedsrichter_no_address`), and where that address is on the ban list
 * (`schiedsrichter_address_barred`). 404 for an id no referee holds, an erased referee's among them, and
 * for the ghost, which every by-id route filters out.
 *
 * **A referee who has already answered is refused rather than sent a second link**: the
 * confirmation refuses every such press, so minting one would replace a live block with a
 * credential that can never be spent.
 * @summary Send a Schiedsrichter a fresh confirmation link
 */
export const schiedsrichterInviteSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterInviteSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterInviteSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * Clear `inactive_since`, putting the referee back into the picker and every default read.
 *
 * **A retired referee who has not answered is owed a fresh link**, named in `confirmation`: a
 * retired referee's save stores a new address and mails nothing, so coming back is what
 * asks them. A row holding no address a link can go to comes back unasked, and so does one whose
 * person has answered. Where a link is minted, an address on the ban list is refused
 * `schiedsrichter_address_barred` and the row stays retired.
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
 * Every report of one season holding a block, each with its state against its fixture and what it proposes.
 *
 * What the season editor counts before an undraw or a replace, which a submitted report refuses
 * (`spielplan_berichte_submitted`). Scoped to `saison_id`, the active season when none is named, which answers 404 while no
 * season is active.
 * @summary Every report of a season and the state it reads in
 */
export const SpielberichteGetSpielberichteQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
});

/**
 * What the booked referee's report form reads.
 *
 * The fixture, both clubs' live squads of the season, the pupils the stored report names outside them, and the stored
 * report, its remarks and card reasons included, or null.
 *
 * Served for a fixture still to come or called off too, whose page says why it takes no report, with both squads
 * empty: the pupils the stored report names are then all in `named`. Once the fixture's season has ended,
 * `completed` is true and the read is the report alone, both squads empty, which its referee writes no more.
 * Refused
 * `role_not_held` where the address holds no confirmed, live referee record, and `bericht_not_officiated` where the fixture
 * is booked to none of its records; `document_not_found` for a fixture that does not exist.
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
 * write changing it raises its `version`, so a report the administrator adopted reads `differing` again until it
 * is adopted anew, and a write changing nothing writes nothing. Every write stamps the clubs the fixture fields now,
 * so a report a knockout correction re-fielded a side under reads `sides_changed` until it is written again. Writes
 * no fixture: the result is the administrator's to save.
 *
 * `bericht_stand` is the `version` of the report the form was served, null where none stood: a write composed on
 * another version would replace a report its sender never saw.
 *
 * Refuses, in this order, each writing nothing: an address holding no confirmed, live referee record
 * (`role_not_held`); a fixture that does not exist (`document_not_found`); one booked to none of its records
 * (`bericht_not_officiated`); one whose season has ended, whose report its referee only reads (`saison_past`); a
 * `bericht_stand` other than the version standing now, or than none where none stands (`bericht_meanwhile_changed`); one undated
 * or whose day is still to come (`bericht_not_played`); one called off or struck out (`bericht_cancelled`); a shoot-out
 * proposed on a group-phase fixture (`bericht_elfmeter_in_the_gruppe`); a pupil the write newly names on a side outside that side's
 * live squad of the season, a pupil the report already named on that side staying while the side fields the club it
 * did (`bericht_not_in_kader`); and a yellow or second yellow card naming no reason (`card_reason_missing`). Every refusal but
 * `bericht_meanwhile_changed` is asked again outside the transaction just before answering, the referee's records included, so a
 * write landing on what was judged before that second asking refuses the report rather than letting it stand, and one
 * landing after it stands beside the report; a write of the report itself landing mid-press conflicts with this one,
 * whose retry meets `bericht_meanwhile_changed`. Two first writes at once are two forms opened on no report: the later is
 * refused.
 * @summary Write one fixture's report as its referee
 */
export const spielberichtePutSpielberichtBerichtPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichtePutSpielberichtBerichtParams = zod.object({
  spiel_id: zod.string().regex(spielberichtePutSpielberichtBerichtPathSpielIdRegExp),
});

export const spielberichtePutSpielberichtBerichtBodyBerichtCardsItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePutSpielberichtBerichtBodyBerichtCardsItemSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePutSpielberichtBerichtBodyBerichtCardsMax = 60;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam1Min = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam2Min = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagTeam1ToreOneMin = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagTeam2ToreOneMin = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtRemarksOneMax = 2000;

export const spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePutSpielberichtBerichtBodyBerichtScorersItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePutSpielberichtBerichtBodyBerichtScorersMax = 60;

export const SpielberichtePutSpielberichtBerichtBody = zod
  .object({
    bericht: zod.object({
      cards: zod
        .array(
          zod
            .object({
              colour: zod.enum(["gelb", "gelb_rot", "rot"]),
              minute: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtCardsItemMinuteRegExp),
              reason: zod.union([
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
              side: zod.enum(["team1", "team2"]),
              spieler_id: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtCardsItemSpielerIdRegExp),
            })
            .describe("One card as a write sends it: a caution names its reason (`find_card_reason_missing_refusal`)."),
        )
        .max(spielberichtePutSpielberichtBerichtBodyBerichtCardsMax),
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
      remarks: zod.union([zod.string().min(1).max(spielberichtePutSpielberichtBerichtBodyBerichtRemarksOneMax), zod.null()]),
      scorers: zod
        .array(
          zod
            .object({
              eigentor: zod.boolean(),
              minute: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp),
              side: zod.enum(["team1", "team2"]),
              spieler_id: zod.union([
                zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtScorersItemSpielerIdOneRegExp),
                zod.null(),
              ]),
            })
            .describe(
              "One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.",
            ),
        )
        .max(spielberichtePutSpielberichtBerichtBodyBerichtScorersMax),
    }),
    bericht_stand: zod.union([zod.int(), zod.null()]),
    version: zod.union([zod.int(), zod.null()]).optional(),
  })
  .describe("The whole `bericht` block, written wholesale by the referee's PUT.");

/**
 * Every confirmation row of the season, or of its one fixture.
 *
 * Newest first, closed rows included. No seat's link hashes and no seat's address are served. Every row still
 * holding its party's question is served; `limit` cuts the others, and `complete` is false where it left the
 * oldest of them out. Each seat holding a link names what became of the last mail owed to it. A season no document
 * has answers no rows rather than 404.
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
 * (`ansetzung_answered`). Writes no fixture: a proposal is the administrator's to act on.
 *
 * Refuses, in this order: a token no seat holds (`link_invalid`); a link whose seat's address the ban list holds
 * now, whenever it was minted (`link_barred`); a row already answered, closed since or not
 * (`ansetzung_answered`); one closed unanswered (`ansetzung_closed`); a fixture decided, called off or left by a club
 * (`ansetzung_decided`), then one whose date, time, ground or sides moved since the link (`ansetzung_changed`), each
 * as the confirmation pass's close judges the row; an answer after the deadline's day (`ansetzung_deadline_past`); a
 * proposal dated before today (`ansetzung_vorschlag_past`); one naming the day and hour the fixture already holds
 * (`ansetzung_vorschlag_unchanged`, on both boxes); and a proposal the administrator's own save of that date would be
 * refused, judged on what it newly claims and in that save's order: on or after a club's exit
 * (`eligibility_disqualified`), outside the matchday (`spiel_outside_spieltag`), or within four hours of the ground's or the referee's
 * other fixture (`spiel_double_booked`). The reason is stored as typed. Every refusal after the ban's is asked again outside
 * the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
 * than letting it stand.
 * @summary Confirm a fixture's Ansetzung, or decline it proposing another date
 */
export const spielbestaetigungenPostSpielbestaetigungBodyReasonOneMax = 500;

export const spielbestaetigungenPostSpielbestaetigungBodyReasonOneRegExp = new RegExp("^[^\\x00\\v\\f\\u0085\\u2028\\u2029]*$");
export const spielbestaetigungenPostSpielbestaetigungBodyTokenMax = 128;

export const spielbestaetigungenPostSpielbestaetigungBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneDateRegExp = new RegExp(
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
);
export const spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneTimeRegExp = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$");

export const SpielbestaetigungenPostSpielbestaetigungBody = zod
  .object({
    answer: zod.enum(["zugesagt", "declined"]),
    reason: zod.union([
      zod
        .string()
        .min(1)
        .max(spielbestaetigungenPostSpielbestaetigungBodyReasonOneMax)
        .regex(spielbestaetigungenPostSpielbestaetigungBodyReasonOneRegExp),
      zod.null(),
    ]),
    token: zod
      .string()
      .min(1)
      .max(spielbestaetigungenPostSpielbestaetigungBodyTokenMax)
      .regex(spielbestaetigungenPostSpielbestaetigungBodyTokenRegExp),
    vorschlag: zod.union([
      zod.object({
        date: zod.string().regex(spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneDateRegExp),
        time: zod.string().regex(spielbestaetigungenPostSpielbestaetigungBodyVorschlagOneTimeRegExp),
      }),
      zod.null(),
    ]),
  })
  .describe("One club's answer about one Ansetzung, from whichever of its seats pressed first.");

/**
 * Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what it did, counted.
 *
 * Each mail is owed through the Postausgang in the transaction that writes its row.
 *
 * The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
 * to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
 * those, a row whose fixture's day is before today closes `spiel_past`, so nobody is asked about a past date. A
 * club's decline closed `discarded` is closed again for each of those but a move and a referee change, in the pass
 * that closes an agreement beside it, and once the day it was about has passed: the public fixture then stops
 * counting it as that club's agreement.
 *
 * A closing owes its party a notice in its own transaction where the party's first request or Einteilung was owed,
 * about a day today or later: for a move, „Spiel verlegt“, naming the slot it left and the one the fixture holds now
 * where the party is still one of its sides or its referee and that slot has a day, an hour and both sides; for a
 * referee taken off the fixture -- ahead of a move it shares a close with, and never for the referee's own decline, which closed its row
 * as it was given -- and for a call-off, the slot the row was about; for an `austritt`, the slot too, to a referee alone,
 * each opponent having been told at the exit's own write (`app/api/spielbestaetigungen/crud.py ::
 * owe_the_austritt_notices_in_session`). A club is told at every address its season row's seats hold now, a referee at
 * the address their record holds; a party nobody is left to tell is told nothing.
 *
 * The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
 * ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
 * its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `discarded`: a
 * decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
 * referee's ghost gets no referee row, the ghost holding no address. The deadline falls the notice period
 * (`app/shared/schemas/bounds.py :: SPIEL_CONFIRMATION_DEADLINE_DAYS`) before the fixture, or today where that has passed.
 * Each seat holding an address is owed one link, a person holding two seats one link naming both, each minted when the
 * mail is handed out, and the row is stamped as asked; a referee row is owed its Einteilung, with no link. An open row's
 * occupied seat holding no link -- its holder replaced, newly seated, or a ban since lifted -- is owed one too. A
 * party still asked by a fixture that moved to a slot the mint asks today is the mint's, never the close's: in the
 * transaction asking about the new slot, the mint closes the party's row about the slot left `ansetzung_changed`, and
 * the request or Einteilung it owes names the slot left, the one mail telling of the move; a party it owes no request,
 * its answer about the new slot standing or no seat of its reachable, is owed the move's notice instead. A fixture
 * holding any other unclosed row about an Ansetzung it has left is asked once the close has shut it, the close owing
 * its notice first.
 *
 * The one reminder owes a fresh link per person on each team row never reminded whose deadline lies the reminder's
 * days away (`app/shared/schemas/bounds.py :: SPIEL_REMINDER_DAYS`), minted beside the links already mailed so every
 * one of them answers until the deadline, and stamps the day. It passes over each seat
 * whose last mail did not arrive, and reminds no row this pass inserted nor one whose request was owed today; where
 * this pass's mint owed one of a row's seats a fresh link, that request is the seat's message of the day and the row's
 * other seats are reminded beside it.
 *
 * A seat whose address the ban list holds is owed nothing and has nothing written, so it stays due and a later pass asks
 * it once the ban is lifted.
 *
 * Each step takes a bounded share and leaves the rest due. A row whose write fails is passed over alone, logged by id
 * and counted in `failed`; any other failure is raised, every step committed before it standing with its mails.
 *
 * A season that is not `active` is passed by whole -- nothing closed, minted or reminded -- so a mistyped call, or one for
 * a season ended since the listing, mails nobody. 404 where no season has the id.
 * @summary Run one season's fixture confirmation pass
 */
export const SpielbestaetigungenSweepSpielbestaetigungenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Answer what the page renders for the fixture this token asks a club about, and nobody's name or address (`READ-ANSETZUNG-001`).
 *
 * The state, which side the reader's club plays, the fixture as it stands now (or, where it moved since the link, the
 * Ansetzung the link asked about), the row's deadline, the other club's proposal and which role answered. A POST that
 * reads, so the token travels in a body and never in a second URL. Refuses only a token no seat of any row holds
 * (`link_invalid`), a guess and a link voided when its seat changed hands alike: an answered, closed, moved,
 * decided or expired link is SERVED in that state rather than refused, so a reopened link shows what became of it. The
 * state is `barred`, ahead of every other, wherever the ban list holds the address the seat's links were mailed to.
 * `vorschlag` is the state of an open link while the other club's decline proposes another date for the same
 * Ansetzung, whose date and hour alone are served.
 * @summary What one fixture confirmation link opens
 */
export const spielbestaetigungenGetSpielbestaetigungViewBodyTokenMax = 128;

export const spielbestaetigungenGetSpielbestaetigungViewBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const SpielbestaetigungenGetSpielbestaetigungViewBody = zod
  .object({
    token: zod
      .string()
      .min(1)
      .max(spielbestaetigungenGetSpielbestaetigungViewBodyTokenMax)
      .regex(spielbestaetigungenGetSpielbestaetigungViewBodyTokenRegExp),
  })
  .describe("The token of the link a person opened, in the body: a token in a URL reaches the edge's access line.");

/**
 * Move a fixture to the date and hour a club's open decline proposes, through the fixture's own save.
 *
 * Refused for any row but an open club decline proposing a date about the fixture's current Ansetzung, the row a
 * discard closes (`ansetzung_not_adoptable`), and for a proposed day gone by (`ansetzung_vorschlag_past_as_stored`, the
 * stored proposal's 409). The fixture is saved as the administrator's save would carry it on the proposed day and
 * hour, everything else kept, so it meets every rule that save meets and is refused as that save is, by its code and
 * status alone, as the draw answers the season write's refusals: no refusal names a field, the request carrying no
 * body. A code the save names a field by is answered under its twin for that field instead, a 409: the ground or the
 * referee booked beside the proposed slot (`spiel_double_booked_spielort_as_stored`,
 * `spiel_double_booked_schiedsrichter_as_stored`), a side out of the season by then
 * (`eligibility_disqualified_team1_as_stored`, `eligibility_disqualified_team2_as_stored`). The bracket is resolved
 * as that save resolves it. The
 * row is not closed here: the fixture has left the Ansetzung it answers, so its links read `invalid` at once and the
 * next confirmation pass closes every party's row `ansetzung_changed`, owing each party „Spiel verlegt“ and asking it
 * about the new slot. IRREVERSIBLE as a save is: moving the fixture back is another save.
 * @summary Adopt a club's proposed date
 */
export const spielbestaetigungenAdoptSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenAdoptSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenAdoptSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

/**
 * Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.
 *
 * The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
 * null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
 * booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
 * the season's end. Answering is open until the fixture's day, whatever deadline a club's row of the same fixture
 * carries.
 *
 * Refuses, in this order: an address holding no live, confirmed referee record (`role_not_held`); an id naming no
 * row of an `active` season, or a row naming none of those records (`ansetzung_foreign_row`, one answer for both); a row
 * already answered, by them or by the league for them (`ansetzung_answered`); one closed unanswered
 * (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one whose date,
 * time, ground or sides moved since the row, or which books another referee or none (`ansetzung_changed`); and a
 * fixture whose day has gone by (`ansetzung_deadline_past`). An acceptance is judged again outside the transaction just
 * before answering, so a move or a reassignment landing mid-answer refuses it rather than letting it stand.
 *
 * **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
 * on the public fixture, and a decline takes it off.
 * @summary Accept or decline one of the signed-in referee's own fixture assignments
 */
export const spielbestaetigungenPostSchiedsrichterAnswerPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenPostSchiedsrichterAnswerParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenPostSchiedsrichterAnswerPathSpielbestaetigungIdRegExp),
});

export const spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneMax = 500;

export const spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneRegExp = new RegExp("^[^\\x00\\v\\f\\u0085\\u2028\\u2029]*$");

export const SpielbestaetigungenPostSchiedsrichterAnswerBody = zod
  .object({
    answer: zod.enum(["zugesagt", "declined"]),
    reason: zod.union([
      zod
        .string()
        .min(1)
        .max(spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneMax)
        .regex(spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneRegExp),
      zod.null(),
    ]),
  })
  .describe("A referee's answer about one row naming them: a decline gives a reason, which the administrator reads.");

/**
 * Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.
 *
 * IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `discarded`, which is that club's one
 * answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
 * counts it as the club's agreement, the league having kept the date, until a pass closes it again as it closes an
 * agreement beside it. Where its day is still to come, the club is owed a notice that the date stands, at every
 * address its season row's seats hold now, in the same transaction. Refused for any other row -- open, agreed,
 * declined without a proposal, a referee's, closed, or about an Ansetzung the fixture has left, the fixture moving
 * while this request runs included (`ansetzung_not_discardable`): the confirmation pass closes that row and tells its club of
 * the move.
 * @summary Discard a club's proposed date
 */
export const spielbestaetigungenDiscardSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenDiscardSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenDiscardSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

/**
 * Record that the party of an open confirmation agreed to its Ansetzung elsewhere than through its link.
 *
 * The administrator's reason says how. IRREVERSIBLE: the answer is the league's record of how a date was agreed, and
 * nothing rewrites it. It names nobody: no seat and no person is recorded, and the reason takes any text and goes at
 * the season's end. Refused for a row
 * already answered, by a seat or by an administrator, or closed (`ansetzung_not_enterable`), including one a seat answers
 * while this request runs: of the two answers exactly one is stored. A row about an Ansetzung the fixture has since
 * left is settled as asked, and the next confirmation pass closes it.
 * @summary Record a party's Zusage on its behalf
 */
export const spielbestaetigungenEnterSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenEnterSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenEnterSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

export const spielbestaetigungenEnterSpielbestaetigungBodyReasonMax = 500;

export const spielbestaetigungenEnterSpielbestaetigungBodyReasonRegExp = new RegExp("^[^\\x00\\v\\f\\u0085\\u2028\\u2029]*$");

export const SpielbestaetigungenEnterSpielbestaetigungBody = zod
  .object({
    reason: zod
      .string()
      .min(1)
      .max(spielbestaetigungenEnterSpielbestaetigungBodyReasonMax)
      .regex(spielbestaetigungenEnterSpielbestaetigungBodyReasonRegExp),
  })
  .describe(
    "The administrator's Zusage for a party that answered elsewhere, and how it was given.\n\nNo way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.",
  );

/**
 * Every matchday and knockout round of one season, a planned one included, its matches in the admin shape, in order.
 *
 * Each round holds its matches by number, and the rounds come in the order they are played. The matchday to open on
 * is the Spielplan's own: the first holding a match still to be played, else the last; a finished season opens on its
 * last. `document_not_found` for a season id naming no season. Writes nothing.
 * @summary One Saison's Spiele by matchday, for the admin Spiele list
 */
export const SpieleGetSpieleSpielplanQueryParams = zod.object({
  saison_id: zod.string().describe("The season whose matchdays and knockout rounds the list shows"),
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
 * The fixture stores no name: every read joins it. With `adopts_bericht` the save also stamps the fixture's Spielbericht
 * adopted, where it still stands at that version about the clubs the save leaves; a miss refuses nothing. A
 * `dry_run` answers the same report and writes nothing, and names in `recipients` every party the confirmation pass
 * would mail about the fixture once it is saved so: told of its move, of the referee taken off it, or of its call-off,
 * by the pass's own rules. A `past` season's fixture is refused (`saison_past`), the `dry_run` included. The save
 * deletes only the later results its body's `voided_results` names, each by its value as its `dry_run` answered it,
 * and is refused whole where it would delete any other set (`voided_results_stale`), judged in its own transaction:
 * a result entered or changed after the question was asked is never deleted unasked.
 * @summary Update a Spiel
 */
export const spielePatchSpielPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielePatchSpielParams = zod.object({
  spiel_id: zod.string().regex(spielePatchSpielPathSpielIdRegExp),
});

export const spielePatchSpielQueryDryRunDefault = false;

export const SpielePatchSpielQueryParams = zod.object({
  adopts_bericht: zod
    .union([zod.int().min(1), zod.null()])
    .optional()
    .describe("The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted"),
  dry_run: zod
    .boolean()
    .default(spielePatchSpielQueryDryRunDefault)
    .describe("Report what this payload would move and destroy, and write nothing"),
});

export const spielePatchSpielBodyDateOneRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spielePatchSpielBodyDateThreeRegExp = new RegExp("^\\s*$");
export const spielePatchSpielBodyElfmeterschiessenOneTeam1Min = 0;

export const spielePatchSpielBodyElfmeterschiessenOneTeam2Min = 0;

export const spielePatchSpielBodyNoteOneMax = 4096;

export const spielePatchSpielBodySchiedsrichterOnePaymentMin = 0;

export const spielePatchSpielBodySchiedsrichterOneSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielBodySpielortOneMietpreisMin = 0;

export const spielePatchSpielBodySpielortOneSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielBodyTeam1OneTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielBodyTeam1OneToreOneMin = 0;

export const spielePatchSpielBodyTeam1QuelleOneOnePlatzExclusiveMin = 0;

export const spielePatchSpielBodyTeam1QuelleOneTwoSpielNrExclusiveMin = 0;

export const spielePatchSpielBodyTeam2OneTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielBodyTeam2OneToreOneMin = 0;

export const spielePatchSpielBodyTeam2QuelleOneOnePlatzExclusiveMin = 0;

export const spielePatchSpielBodyTeam2QuelleOneTwoSpielNrExclusiveMin = 0;

export const spielePatchSpielBodyTimeOneRegExp = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$");
export const spielePatchSpielBodyTimeThreeRegExp = new RegExp("^\\s*$");
export const spielePatchSpielBodyVersionMin = 0;

export const spielePatchSpielBodyVoidedResultsItemSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielePatchSpielBodyVoidedResultsItemSpielNrExclusiveMin = 0;

export const spielePatchSpielBodyVoidedResultsItemVoidedElfmeterschiessenOneTeam1Min = 0;

export const spielePatchSpielBodyVoidedResultsItemVoidedElfmeterschiessenOneTeam2Min = 0;

export const spielePatchSpielBodyVoidedResultsItemVoidedErgebnisOneRegExp = new RegExp("^[0-9]+:[0-9]+$");

export const SpielePatchSpielBody = zod.object({
  date: zod.union([zod.string().regex(spielePatchSpielBodyDateOneRegExp), zod.null(), zod.string().regex(spielePatchSpielBodyDateThreeRegExp)]),
  elfmeterschiessen: zod.union([
    zod
      .object({
        team1: zod.int().min(spielePatchSpielBodyElfmeterschiessenOneTeam1Min),
        team2: zod.int().min(spielePatchSpielBodyElfmeterschiessenOneTeam2Min),
      })
      .describe("The penalty shoot-out that settled a level knockout fixture: the side with more goals in it won."),
    zod.null(),
  ]),
  note: zod.union([zod.string().max(spielePatchSpielBodyNoteOneMax), zod.null()]),
  schiedsrichter: zod.union([
    zod
      .object({
        payment: zod.int().min(spielePatchSpielBodySchiedsrichterOnePaymentMin),
        schiedsrichter_id: zod.string().regex(spielePatchSpielBodySchiedsrichterOneSchiedsrichterIdRegExp),
      })
      .describe("The referee as the save sends it: who, and what this fixture pays them."),
    zod.null(),
  ]),
  sonderereignis: zod.union([zod.enum(["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"]), zod.null()]),
  spielort: zod.union([
    zod
      .object({
        mietpreis: zod.int().min(spielePatchSpielBodySpielortOneMietpreisMin),
        spielort_id: zod.string().regex(spielePatchSpielBodySpielortOneSpielortIdRegExp),
      })
      .describe("The venue as the save sends it: which ground, and what this fixture pays for it."),
    zod.null(),
  ]),
  team1: zod.union([
    zod
      .object({
        team_id: zod.string().regex(spielePatchSpielBodyTeam1OneTeamIdRegExp),
        tore: zod.union([zod.int().min(spielePatchSpielBodyTeam1OneToreOneMin), zod.null()]),
      })
      .describe(
        "One side of a fixture as the save sends it: the team and its goals.\n\nA name sent is ignored: a side's name and shorthand are its season row's, joined at read.",
      ),
    zod.null(),
  ]),
  team1_quelle: zod.union([
    zod.union([
      zod
        .object({
          gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
          platz: zod.int().gt(spielePatchSpielBodyTeam1QuelleOneOnePlatzExclusiveMin),
          type: zod.enum(["gruppe"]),
        })
        .describe("A slot fed by the group phase: the team finishing `platz` in `gruppe`."),
      zod
        .object({
          ausgang: zod.enum(["sieger", "verlierer"]),
          spiel_nr: zod.int().gt(spielePatchSpielBodyTeam1QuelleOneTwoSpielNrExclusiveMin),
          type: zod.enum(["spiel"]),
        })
        .describe("A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."),
    ]),
    zod.null(),
  ]),
  team2: zod.union([
    zod
      .object({
        team_id: zod.string().regex(spielePatchSpielBodyTeam2OneTeamIdRegExp),
        tore: zod.union([zod.int().min(spielePatchSpielBodyTeam2OneToreOneMin), zod.null()]),
      })
      .describe(
        "One side of a fixture as the save sends it: the team and its goals.\n\nA name sent is ignored: a side's name and shorthand are its season row's, joined at read.",
      ),
    zod.null(),
  ]),
  team2_quelle: zod.union([
    zod.union([
      zod
        .object({
          gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
          platz: zod.int().gt(spielePatchSpielBodyTeam2QuelleOneOnePlatzExclusiveMin),
          type: zod.enum(["gruppe"]),
        })
        .describe("A slot fed by the group phase: the team finishing `platz` in `gruppe`."),
      zod
        .object({
          ausgang: zod.enum(["sieger", "verlierer"]),
          spiel_nr: zod.int().gt(spielePatchSpielBodyTeam2QuelleOneTwoSpielNrExclusiveMin),
          type: zod.enum(["spiel"]),
        })
        .describe("A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."),
    ]),
    zod.null(),
  ]),
  time: zod.union([zod.string().regex(spielePatchSpielBodyTimeOneRegExp), zod.null(), zod.string().regex(spielePatchSpielBodyTimeThreeRegExp)]),
  version: zod.int().min(spielePatchSpielBodyVersionMin),
  voided_results: zod
    .array(
      zod
        .object({
          spiel_id: zod.string().regex(spielePatchSpielBodyVoidedResultsItemSpielIdRegExp),
          spiel_nr: zod.int().gt(spielePatchSpielBodyVoidedResultsItemSpielNrExclusiveMin),
          voided_elfmeterschiessen: zod.union([
            zod
              .object({
                team1: zod.int().min(spielePatchSpielBodyVoidedResultsItemVoidedElfmeterschiessenOneTeam1Min),
                team2: zod.int().min(spielePatchSpielBodyVoidedResultsItemVoidedElfmeterschiessenOneTeam2Min),
              })
              .describe("The penalty shoot-out that settled a level knockout fixture: the side with more goals in it won."),
            zod.null(),
          ]),
          voided_ergebnis: zod.union([zod.string().regex(spielePatchSpielBodyVoidedResultsItemVoidedErgebnisOneRegExp), zod.null()]),
          voided_sonderereignis: zod.union([
            zod.enum(["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"]),
            zod.null(),
          ]),
        })
        .describe(
          "A later fixture's stored result that a save deletes: its ground score, its shoot-out and a no-show, each null where it held none.",
        ),
    )
    .optional(),
});

/**
 * The match editor's one read: the fixture in the admin shape, money and `version` included, and its season's status.
 *
 * Beside it every live venue and referee to book, the fixture's own where it has retired, each referee saying whether
 * they confirmed their entry; on a knockout fixture every club of its season, each saying whether it stands on
 * another fixture of the matchday and whether a save fielding it here by hand would pass the write's rules, null on a
 * group fixture; the fixture's report as its Spielbericht section shows it, its goals, its proposal and the state it
 * reads in, null where none stands; and the fixture's confirmation rows as the confirmations' read serves them.
 * `document_not_found` for an id no fixture holds.
 * @summary One Spiel and all the match editor offers and shows beside it
 */
export const spieleGetSpielAdminPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieleGetSpielAdminParams = zod.object({
  spiel_id: zod.string().regex(spieleGetSpielAdminPathSpielIdRegExp),
});

/**
 * Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.
 *
 * Writes those two on this one record, each moved choice with its evidence (`evidence.<choice>`), and nothing else:
 * the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
 * PATCH moving neither choice writes nothing.
 *
 * Refuses, in this order: an address holding no confirmed pupil record (`role_not_held`); a `evidence_state`
 * other than the record's own, either choice having moved since the page was served (`choices_stale`); a choice
 * moving onto a grant under a label other than its
 * current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to `true` where
 * the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
 * refusal writes nothing.
 *
 * **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
 * name is served, and nothing here can.
 * @summary Change a signed-in pupil's own publication and media consent
 */
export const SpielerPatchEinwilligungBody = zod
  .object({
    evidence_state: zod.object({
      media: zod.union([zod.string(), zod.null()]),
      scope: zod.union([zod.string(), zod.null()]),
    }),
    media: zod.boolean(),
    scope: zod.enum(["kader_public", "internal"]),
    text_versions: zod
      .object({
        media: zod.literal("2026-11-medien-1"),
        scope: zod.literal("2026-11-name-kader-1"),
      })
      .describe("A pupil's two wordings: the name on the squad and the media switch."),
  })
  .describe("A pupil's or a registration's own two choices on their record.");

/**
 * The squad of one team in one season, for a person holding any contact seat on it.
 *
 * Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
 * e-mail address or telephone number of anybody. `nummer_double` marks a live row whose number
 * another live row of the squad wears, compared as stored. `allowed_stufen` is what the season's
 * rules offer an edit. Refused `role_not_held` where the signed-in person holds no seat on this
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
 * another team's pupil and an ausgetragen row alike. Refused `role_not_held` without a seat.
 * @summary Take a Spieler out of the squad as its team's seat holder (retire)
 */
export const spielerDeleteKaderRowPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielerDeleteKaderRowPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerDeleteKaderRowParams = zod.object({
  team_id: zod.string().regex(spielerDeleteKaderRowPathTeamIdRegExp),
  saison_id: zod.string(),
  spieler_id: zod.string().regex(spielerDeleteKaderRowPathSpielerIdRegExp),
});

/**
 * Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.
 *
 * The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
 * row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
 * nothing is written. Refused `role_not_held` without a seat, `kader_stufe_not_allowed` for a `stufe` the
 * season's `allowed_stufen` does not offer unless the row already holds it, and `kader_rolle_taken`
 * for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
 * @summary Update a squad entry as its team's seat holder
 */
export const spielerPatchKaderRowPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielerPatchKaderRowPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPatchKaderRowParams = zod.object({
  team_id: zod.string().regex(spielerPatchKaderRowPathTeamIdRegExp),
  saison_id: zod.string(),
  spieler_id: zod.string().regex(spielerPatchKaderRowPathSpielerIdRegExp),
});

export const spielerPatchKaderRowBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");

export const SpielerPatchKaderRowBody = zod
  .object({
    nummer: zod.union([zod.string().regex(spielerPatchKaderRowBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    rolle: zod.union([zod.enum(["kapitaen", "co_kapitaen"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    version: zod.union([zod.int(), zod.null()]).optional(),
  })
  .describe("A seat holder's edit of a squad row.");

/**
 * The Spieler page in one read: every squad row of the season, live and ausgetragen alike, each named and with its club.
 *
 * Read whole, as every list but the Protokoll is, the page narrowing what it holds. `nummer_double` marks a live row
 * whose number another live row of its own squad wears, compared as stored. 404 where no season holds that id.
 * @summary One Saison's squad rows for its list
 */
export const SpielerGetSpielerAdminQueryParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One player's id, forename and surname initial, both names `null` where the pupil's consent does not publish them.
 * @summary One Spieler
 */
export const spielerGetSpielerByIdPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerGetSpielerByIdParams = zod.object({
  spieler_id: zod.string().regex(spielerGetSpielerByIdPathSpielerIdRegExp),
});

/**
 * Take a player out of a season's squad. SOFT: the row stays.
 *
 * The row records that this player wore this number in this squad, which stays true after they
 * leave. `GET /spieler/list/admin` is where an admin reads it back, marked by `inactive_since`.
 * @summary Remove a Spieler from a squad
 */
export const spielerDeleteSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerDeleteSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerDeleteSaisonSpielerPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * Return what the Spieler editor shows in one read: the person, their squad row of the season, and what its boxes offer.
 *
 * `version` is what the one save sends. `allowed_stufen` is what the season's rules offer, `taken_rollen` each role
 * another live row of the squad holds. Read outside a transaction: a write landing under this read is judged by its own
 * write. 404 where no person, no season or no squad row of the person in that season holds those ids: the page stands
 * under a season, and a person out of its squad is no row of that season's list.
 * @summary What the Spieler editor shows, in one read
 */
export const spielerGetSpielerSaisonPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerGetSpielerSaisonParams = zod.object({
  spieler_id: zod.string().regex(spielerGetSpielerSaisonPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * Save the Spieler editor's one version: the person's own facts and their squad row of the season.
 *
 * The team stays the stored row's: no player moves between teams. Refused `version_stale` once the person or the row has
 * moved since the editor read them, whichever it was; `kader_stufe_not_allowed` for a `stufe` the season's rules do not
 * offer unless the row already holds it; `kader_rolle_taken` for a `rolle` another live row of the squad holds. A shared
 * `nummer` is permitted (`docs/domain.md`'s what the model permits on purpose). 404 where the person holds no row of the
 * season. No fan-out: unlike a team or a venue, a person is embedded in no other document.
 * @summary Save the Spieler editor: the person and their squad row of the season, in one transaction
 */
export const spielerPatchSpielerSaisonPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerPatchSpielerSaisonParams = zod.object({
  spieler_id: zod.string().regex(spielerPatchSpielerSaisonPathSpielerIdRegExp),
  saison_id: zod.string(),
});

export const spielerPatchSpielerSaisonBodyBirthDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spielerPatchSpielerSaisonBodyFirstNameMax = 80;

export const spielerPatchSpielerSaisonBodyFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const spielerPatchSpielerSaisonBodyLastNameOneMax = 80;

export const spielerPatchSpielerSaisonBodyLastNameOneRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const spielerPatchSpielerSaisonBodyNummerOneRegExp = new RegExp("^[0-9]{1,4}$");
export const spielerPatchSpielerSaisonBodyVersionMin = 0;

export const SpielerPatchSpielerSaisonBody = zod
  .object({
    birth_date: zod.string().regex(spielerPatchSpielerSaisonBodyBirthDateRegExp),
    first_name: zod.string().min(1).max(spielerPatchSpielerSaisonBodyFirstNameMax).regex(spielerPatchSpielerSaisonBodyFirstNameRegExp),
    last_name: zod.union([
      zod.string().min(1).max(spielerPatchSpielerSaisonBodyLastNameOneMax).regex(spielerPatchSpielerSaisonBodyLastNameOneRegExp),
      zod.null(),
    ]),
    nummer: zod.union([zod.string().regex(spielerPatchSpielerSaisonBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    rolle: zod.union([zod.enum(["kapitaen", "co_kapitaen"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    version: zod.int().min(spielerPatchSpielerSaisonBodyVersionMin),
  })
  .describe(
    "The Spieler editor's one save: the person, and their squad row in the season the page stands under.\n\nReplaced wholesale, as `_KaderRowFields` is. No consent and no address: each is the person's own to change.",
  );

/**
 * Clear a squad row's `inactive_since`, with the number and position it had.
 *
 * Refused where the squad has filled up, a nominee's row standing outside that cap, where its club
 * left, or where the `rolle` the row carries has been given to somebody else since (`kader_rolle_taken`).
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
 *
 * Refused where another venue holds the name (`duplicate_key`, naming `name`).
 * @summary Create a Spielort
 */
export const spielortePostSpielortBodyAddressCityMax = 80;

export const spielortePostSpielortBodyAddressDistrictMax = 80;

export const spielortePostSpielortBodyAddressHouseNumberMax = 16;

export const spielortePostSpielortBodyAddressHouseNumberRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const spielortePostSpielortBodyAddressPostcodeMin = 5;
export const spielortePostSpielortBodyAddressPostcodeMax = 5;

export const spielortePostSpielortBodyAddressPostcodeRegExp = new RegExp("^[0-9]{5}$");
export const spielortePostSpielortBodyAddressStreetMax = 120;

export const spielortePostSpielortBodyDefaultMietpreisMin = 0;

export const spielortePostSpielortBodyNameMax = 120;

export const SpielortePostSpielortBody = zod.object({
  address: zod.object({
    city: zod.string().min(1).max(spielortePostSpielortBodyAddressCityMax),
    district: zod.string().max(spielortePostSpielortBodyAddressDistrictMax),
    house_number: zod.string().max(spielortePostSpielortBodyAddressHouseNumberMax).regex(spielortePostSpielortBodyAddressHouseNumberRegExp),
    postcode: zod
      .string()
      .min(spielortePostSpielortBodyAddressPostcodeMin)
      .max(spielortePostSpielortBodyAddressPostcodeMax)
      .regex(spielortePostSpielortBodyAddressPostcodeRegExp),
    street: zod.string().min(1).max(spielortePostSpielortBodyAddressStreetMax),
  }),
  default_mietpreis: zod.int().min(spielortePostSpielortBodyDefaultMietpreisMin),
  name: zod.string().min(1).max(spielortePostSpielortBodyNameMax),
});

/**
 * Deactivate a venue. SOFT: it stamps `inactive_since`, and the document stays.
 *
 * A played match names the venue by id, so a hard delete would orphan every historical match that used it. Refused
 * while an unplayed fixture is still booked here (`spielort_still_booked`).
 * @summary Deactivate a Spielort (soft delete)
 */
export const spielorteDeleteSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteDeleteSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteDeleteSpielortPathSpielortIdRegExp),
});

/**
 * The venue editor's one read: the record, its `version` with it, which the editor's save sends back.
 *
 * Admin-tier as the list is, and for the same two rules (`READ-MONEY-001`, `READ-ADDRESS-001`). Retired venues included:
 * the editor reactivates one, and a historical match's venue is the case worth answering.
 * @summary One Spielort
 */
export const spielorteGetSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteGetSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteGetSpielortPathSpielortIdRegExp),
});

/**
 * Update a venue on the `version` the editor was served, answering the version stored, which its next save sends.
 *
 * A fixture names the venue by id and reads its name and `maps_link` at its own read, so nothing else is written; each
 * fixture keeps the `mietpreis` agreed for it. Refused where another venue holds the name (`duplicate_key`, naming
 * `name`).
 * @summary Update a Spielort
 */
export const spielortePatchSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielortePatchSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielortePatchSpielortPathSpielortIdRegExp),
});

export const spielortePatchSpielortBodyAddressCityMax = 80;

export const spielortePatchSpielortBodyAddressDistrictMax = 80;

export const spielortePatchSpielortBodyAddressHouseNumberMax = 16;

export const spielortePatchSpielortBodyAddressHouseNumberRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const spielortePatchSpielortBodyAddressPostcodeMin = 5;
export const spielortePatchSpielortBodyAddressPostcodeMax = 5;

export const spielortePatchSpielortBodyAddressPostcodeRegExp = new RegExp("^[0-9]{5}$");
export const spielortePatchSpielortBodyAddressStreetMax = 120;

export const spielortePatchSpielortBodyDefaultMietpreisMin = 0;

export const spielortePatchSpielortBodyNameMax = 120;

export const spielortePatchSpielortBodyVersionMin = 0;

export const SpielortePatchSpielortBody = zod.object({
  address: zod.object({
    city: zod.string().min(1).max(spielortePatchSpielortBodyAddressCityMax),
    district: zod.string().max(spielortePatchSpielortBodyAddressDistrictMax),
    house_number: zod.string().max(spielortePatchSpielortBodyAddressHouseNumberMax).regex(spielortePatchSpielortBodyAddressHouseNumberRegExp),
    postcode: zod
      .string()
      .min(spielortePatchSpielortBodyAddressPostcodeMin)
      .max(spielortePatchSpielortBodyAddressPostcodeMax)
      .regex(spielortePatchSpielortBodyAddressPostcodeRegExp),
    street: zod.string().min(1).max(spielortePatchSpielortBodyAddressStreetMax),
  }),
  default_mietpreis: zod.int().min(spielortePatchSpielortBodyDefaultMietpreisMin),
  name: zod.string().min(1).max(spielortePatchSpielortBodyNameMax),
  version: zod.int().min(spielortePatchSpielortBodyVersionMin),
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
 * List a season's matchdays for the admin surfaces, a `future` season's included.
 *
 * No season gate: a season's matchdays are drawn while it is planned, and dating them is what this
 * list is for.
 * @summary Spieltage for the admin surfaces
 */
export const spieltageGetSpieltageAdminQueryLimitDefault = 1024;
export const spieltageGetSpieltageAdminQueryLimitMax = 1024;

export const spieltageGetSpieltageAdminQuerySortByDefault = `natural`;
export const spieltageGetSpieltageAdminQueryOrderDefault = `asc`;

export const SpieltageGetSpieltageAdminQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  saison_phase: zod
    .union([zod.literal("playoffs"), zod.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]), zod.null()])
    .optional(),
  limit: zod.int().min(1).max(spieltageGetSpieltageAdminQueryLimitMax).default(spieltageGetSpieltageAdminQueryLimitDefault),
  sort_by: zod.enum(["natural", "start", "end"]).default(spieltageGetSpieltageAdminQuerySortByDefault),
  order: zod.enum(["asc", "desc"]).default(spieltageGetSpieltageAdminQueryOrderDefault),
});

/**
 * One matchday by its id, its match count derived from its own season's rules.
 *
 * 404 for a matchday of a season this tier may not read.
 * @summary One Spieltag
 */
export const spieltageGetSpieltagPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltageGetSpieltagParams = zod.object({
  spieltag_id: zod.string().regex(spieltageGetSpieltagPathSpieltagIdRegExp),
});

/**
 * Move a matchday's span, answering the matchday's `version` after the save.
 *
 * No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span is held
 * to its season's, to the days its own fixtures stand on, and its `start` to the order its phase is dated in. A
 * `past` season's matchday is refused (`saison_past`), as its fixtures' saves are: a finished season's record is
 * closed.
 * @summary Re-date a Spieltag
 */
export const spieltagePatchSpieltagPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltagePatchSpieltagParams = zod.object({
  spieltag_id: zod.string().regex(spieltagePatchSpieltagPathSpieltagIdRegExp),
});

export const spieltagePatchSpieltagBodyEndRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spieltagePatchSpieltagBodyStartRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spieltagePatchSpieltagBodyVersionMin = 0;

export const SpieltagePatchSpieltagBody = zod.object({
  end: zod.string().regex(spieltagePatchSpieltagBodyEndRegExp),
  start: zod.string().regex(spieltagePatchSpieltagBodyStartRegExp),
  version: zod.int().min(spieltagePatchSpieltagBodyVersionMin),
});

/**
 * Return one matchday by its id for the admin editor, a `future` season's included.
 *
 * The shape of `GET /spieltage/{spieltag_id}`, without its season gate, plus `count_spieltage_in_phase`, how many
 * matchdays its phase holds: the editor opens a matchday to date it, and that happens before its season is ever
 * activated. Beside it its season's `status`, read as the re-dating judges it, so the editor opens read-only on
 * exactly the season the write refuses (`saison_past`).
 * @summary One Spieltag for the admin editor
 */
export const spieltageGetSpieltagAdminPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltageGetSpieltagAdminParams = zod.object({
  spieltag_id: zod.string().regex(spieltageGetSpieltagAdminPathSpieltagIdRegExp),
});

/**
 * The Teams page in one read: the season's clubs, a `future` season's included, and what entering another offers.
 *
 * No base-tier season gate: a club is entered while its season is still planned. Each row counts its seats, its state
 * the type of an exit and the day its club left the league. `state=retired` reads past the season's rows to every
 * retired club, which is the way back to one. `entry` is every club still in the league holding no row of the season,
 * each group with whether it is full, `closed` where the season is not `future`, which the entry refuses, and `taken`
 * the colours the season's rows hold. 404 where no season holds that id.
 * @summary One season's Teams list and what its create dialog offers
 */
export const TeamsGetTeamsAdminQueryParams = zod.object({
  saison_id: zod.string(),
  gruppe: zod.union([zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]), zod.null()]).optional(),
  state: zod.union([zod.enum(["active", "departed", "retired"]), zod.null()]).optional(),
});

/**
 * Enter a club into a `future` season in a group and a colour, founding it first where it is new.
 *
 * A new club's `shorthand` is unique across every club, retired ones included: a taken one is refused `duplicate_key`,
 * naming `shorthand`. A retired club is refused `team_retired`, a club the season already holds
 * `bewerbung_picked_team_already_entered`, a colour another row holds `trikot_farbe_taken`, naming `trikot_farbe`, and the
 * season and the group as an entry is.
 * @summary Enter a club into a season, one the league holds or a new one
 */
export const TeamsPostTeamEntryParams = zod.object({
  saison_id: zod.string(),
});

export const teamsPostTeamEntryBodyClubOneTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const teamsPostTeamEntryBodyClubTwoTeamAddressCityMax = 80;

export const teamsPostTeamEntryBodyClubTwoTeamAddressDistrictMax = 80;

export const teamsPostTeamEntryBodyClubTwoTeamAddressHouseNumberMax = 16;

export const teamsPostTeamEntryBodyClubTwoTeamAddressHouseNumberRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const teamsPostTeamEntryBodyClubTwoTeamAddressPostcodeMin = 5;
export const teamsPostTeamEntryBodyClubTwoTeamAddressPostcodeMax = 5;

export const teamsPostTeamEntryBodyClubTwoTeamAddressPostcodeRegExp = new RegExp("^[0-9]{5}$");
export const teamsPostTeamEntryBodyClubTwoTeamAddressStreetMax = 120;

export const teamsPostTeamEntryBodyClubTwoTeamDescriptionMax = 4096;

export const teamsPostTeamEntryBodyClubTwoTeamFullNameMax = 120;

export const teamsPostTeamEntryBodyClubTwoTeamFullNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPostTeamEntryBodyClubTwoTeamNameMax = 60;

export const teamsPostTeamEntryBodyClubTwoTeamNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPostTeamEntryBodyClubTwoTeamShorthandRegExp = new RegExp("^\\s*[A-Za-z]{3}\\s*$");
export const teamsPostTeamEntryBodyClubTwoTeamWebsiteUrlOneMax = 300;

export const TeamsPostTeamEntryBody = zod
  .object({
    club: zod.union([
      zod
        .object({
          kind: zod.literal("known").meta({ title: "Kind" }),
          team_id: zod.string().regex(teamsPostTeamEntryBodyClubOneTeamIdRegExp),
        })
        .describe("A club the league holds, picked from the list's create dialog."),
      zod
        .object({
          kind: zod.literal("new").meta({ title: "Kind" }),
          team: zod.object({
            address: zod.object({
              city: zod.string().min(1).max(teamsPostTeamEntryBodyClubTwoTeamAddressCityMax),
              district: zod.string().max(teamsPostTeamEntryBodyClubTwoTeamAddressDistrictMax),
              house_number: zod
                .string()
                .max(teamsPostTeamEntryBodyClubTwoTeamAddressHouseNumberMax)
                .regex(teamsPostTeamEntryBodyClubTwoTeamAddressHouseNumberRegExp),
              postcode: zod
                .string()
                .min(teamsPostTeamEntryBodyClubTwoTeamAddressPostcodeMin)
                .max(teamsPostTeamEntryBodyClubTwoTeamAddressPostcodeMax)
                .regex(teamsPostTeamEntryBodyClubTwoTeamAddressPostcodeRegExp),
              street: zod.string().min(1).max(teamsPostTeamEntryBodyClubTwoTeamAddressStreetMax),
            }),
            description: zod.string().max(teamsPostTeamEntryBodyClubTwoTeamDescriptionMax),
            full_name: zod
              .string()
              .min(1)
              .max(teamsPostTeamEntryBodyClubTwoTeamFullNameMax)
              .regex(teamsPostTeamEntryBodyClubTwoTeamFullNameRegExp),
            name: zod.string().min(1).max(teamsPostTeamEntryBodyClubTwoTeamNameMax).regex(teamsPostTeamEntryBodyClubTwoTeamNameRegExp),
            schulform: zod.union([
              zod.enum(["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]),
              zod.null(),
            ]),
            shorthand: zod.string().regex(teamsPostTeamEntryBodyClubTwoTeamShorthandRegExp),
            website_url: zod.union([zod.string().max(teamsPostTeamEntryBodyClubTwoTeamWebsiteUrlOneMax), zod.null()]),
          }),
        })
        .describe("A club the entry founds, in the transaction that enters it."),
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
  .describe("One club's entry into a season, the club known or new. One field rather than two nullable ones, so no body names both.");

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
 * One team with its group and its figures in the season the query names, the season the site is on where it names none.
 *
 * 404 where the team, its row in that season or the season is one this tier may not read.
 * @summary One team
 */
export const teamsGetTeamPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamPathTeamIdRegExp),
});

export const teamsGetTeamQueryStatistikScopeDefault = `gruppenphase`;

export const TeamsGetTeamQueryParams = zod.object({
  saison_id: zod.union([zod.string(), zod.null()]).optional(),
  statistik_scope: zod.enum(["gruppenphase", "total"]).default(teamsGetTeamQueryStatistikScopeDefault),
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
 * Set the signed-in person's two consents on every seat they hold on this team's season row: WhatsApp and media.
 *
 * One answer for all of them: a person holding two of the row's slots answers once, each choice moving only where it
 * differs from the row as the page served it, so seats answered apart keep their answers to a choice not changed. No
 * other slot of the row and no other row is written, each choice moving with its own evidence and leaving the
 * other standing; a press moving no seat writes nothing. A GRANT (`scope` to `kontakt_data_whatsapp` or `media`
 * to `true`) is taken on a row of an `active` or `future` season its team has not left; a withdrawal on any row the
 * person confirmed a seat on, a past season's included.
 *
 * Refuses, in this order: a row on which the address holds no confirmed seat (`role_not_held`); a
 * `evidence_state` other than the held seats' own, either choice having moved since the page was served
 * (`choices_stale`); a grant where the row grants no panel (`giving_not_allowed`); a choice moving onto a grant
 * under a label other than its current wording's, the page loaded before a rewording (`grant_wording_stale`);
 * `media` moving to `true` where a held seat's stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is
 * missing (`media_age`). Each refusal writes nothing.
 * @summary Change a seat holder's own WhatsApp and media consent on one team's season
 */
export const teamsPatchEinwilligungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPatchEinwilligungParams = zod.object({
  team_id: zod.string().regex(teamsPatchEinwilligungPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const TeamsPatchEinwilligungBody = zod
  .object({
    evidence_state: zod.object({
      media: zod.union([zod.string(), zod.null()]),
      scope: zod.union([zod.string(), zod.null()]),
    }),
    media: zod.boolean(),
    scope: zod.enum(["kontakt_data", "kontakt_data_whatsapp"]),
    text_versions: zod
      .object({
        media: zod.literal("2026-11-medien-1"),
        scope: zod.literal("2026-11-whatsapp-1"),
      })
      .describe("A contact seat's two wordings: the WhatsApp switch and the media switch."),
  })
  .describe(
    "A seat holder's own two choices for every seat they hold on one row, under any label their kind cites.\n\nBoth choices on every press: a page that sent one alone would leave the other judged by nothing.",
  );

/**
 * Return what the team editor shows in one read: the club, its row of the season, and what each act of the page meets.
 *
 * `version` is what the one save sends. `membership` serves the row with its seats' links and address changes, null for
 * a club holding no row of the season, a retired one reached through the list's filter; `link` is null with it.
 * `gruppen` is each group the season offers with whether it is full, `gruppe_locked` whether a group move is refused
 * `entry_gruppe_locked`, `taken_trikot_farben` the colours another row holds, and `retire_blocked_by` the season
 * `retire_blocked` refuses over, by each write's own judgement.
 * `link` is the live registration link, the window's judgement of it, and why the season's press would pass the team
 * over. Read outside a transaction: a write landing under this read is judged by its own write. 404 where no club or no
 * season holds that id.
 * @summary One team in one season for the admin editor
 */
export const teamsGetTeamSaisonAdminPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamSaisonAdminParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamSaisonAdminPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Save the team editor's one version: the club, the rename's fan-out, and the group and colour of this season's row.
 *
 * Refused `version_stale` once the club or the row has moved since the editor read them, whichever it was. Judged per
 * part: a `past` season keeps the club's fields open and refuses `saison_past` only where the group or the colour
 * changes, since a finished season's table and podium are read off its rows. A shorthand another club holds, a retired one
 * included, is refused `duplicate_key`, naming `shorthand`. A group move is refused as `entry_gruppe_locked` and
 * `entry_gruppe_full` refuse it, and a colour the save moves onto one another row holds `trikot_farbe_taken`, naming
 * `trikot_farbe`. 404 where the club holds no row of the season.
 * @summary Save the team editor: the club and its row of the season, in one transaction
 */
export const teamsPatchTeamSaisonPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPatchTeamSaisonParams = zod.object({
  team_id: zod.string().regex(teamsPatchTeamSaisonPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsPatchTeamSaisonBodyAddressCityMax = 80;

export const teamsPatchTeamSaisonBodyAddressDistrictMax = 80;

export const teamsPatchTeamSaisonBodyAddressHouseNumberMax = 16;

export const teamsPatchTeamSaisonBodyAddressHouseNumberRegExp = new RegExp("^([0-9\\-abcABC]+)?$");
export const teamsPatchTeamSaisonBodyAddressPostcodeMin = 5;
export const teamsPatchTeamSaisonBodyAddressPostcodeMax = 5;

export const teamsPatchTeamSaisonBodyAddressPostcodeRegExp = new RegExp("^[0-9]{5}$");
export const teamsPatchTeamSaisonBodyAddressStreetMax = 120;

export const teamsPatchTeamSaisonBodyDescriptionMax = 4096;

export const teamsPatchTeamSaisonBodyFullNameMax = 120;

export const teamsPatchTeamSaisonBodyFullNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPatchTeamSaisonBodyNameMax = 60;

export const teamsPatchTeamSaisonBodyNameRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");
export const teamsPatchTeamSaisonBodyShorthandRegExp = new RegExp("^\\s*[A-Za-z]{3}\\s*$");
export const teamsPatchTeamSaisonBodyVersionMin = 0;

export const teamsPatchTeamSaisonBodyWebsiteUrlOneMax = 300;

export const TeamsPatchTeamSaisonBody = zod
  .object({
    address: zod.object({
      city: zod.string().min(1).max(teamsPatchTeamSaisonBodyAddressCityMax),
      district: zod.string().max(teamsPatchTeamSaisonBodyAddressDistrictMax),
      house_number: zod.string().max(teamsPatchTeamSaisonBodyAddressHouseNumberMax).regex(teamsPatchTeamSaisonBodyAddressHouseNumberRegExp),
      postcode: zod
        .string()
        .min(teamsPatchTeamSaisonBodyAddressPostcodeMin)
        .max(teamsPatchTeamSaisonBodyAddressPostcodeMax)
        .regex(teamsPatchTeamSaisonBodyAddressPostcodeRegExp),
      street: zod.string().min(1).max(teamsPatchTeamSaisonBodyAddressStreetMax),
    }),
    description: zod.string().max(teamsPatchTeamSaisonBodyDescriptionMax),
    full_name: zod.string().min(1).max(teamsPatchTeamSaisonBodyFullNameMax).regex(teamsPatchTeamSaisonBodyFullNameRegExp),
    gruppe: zod.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]),
    name: zod.string().min(1).max(teamsPatchTeamSaisonBodyNameMax).regex(teamsPatchTeamSaisonBodyNameRegExp),
    schulform: zod.union([
      zod.enum(["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]),
      zod.null(),
    ]),
    shorthand: zod.string().regex(teamsPatchTeamSaisonBodyShorthandRegExp),
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
    version: zod.int().min(teamsPatchTeamSaisonBodyVersionMin),
    website_url: zod.union([zod.string().max(teamsPatchTeamSaisonBodyWebsiteUrlOneMax), zod.null()]),
  })
  .describe(
    "The team editor's one save: the club, and its colour and group in the season the page stands under.\n\nReplaced wholesale. No seat and no `austritt`: a seat is its dialog's, and an exit is the\ndanger box's own write, which owes mail.",
  );

/**
 * Record how a team left the season, once: an exit is never lifted and never replaced.
 *
 * Refused `version_stale` on a row whose exit stands, whatever the write carries, the page having been read before it;
 * `saison_past` on a finished season; and `austritt_before_saison_start` until the season's start date, its `earliest`
 * the start: before it, the replacement takes a club out. 404 where the team holds no row of the season.
 * @summary Record a team's exit from a season
 */
export const teamsPutAustrittPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPutAustrittParams = zod.object({
  team_id: zod.string().regex(teamsPutAustrittPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsPutAustrittBodyDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const teamsPutAustrittBodyReasonMax = 500;

export const teamsPutAustrittBodyReasonRegExp = new RegExp("^[^\\x00\\v\\f\\u0085\\u2028\\u2029]*$");

export const TeamsPutAustrittBody = zod
  .object({
    date: zod.string().regex(teamsPutAustrittBodyDateRegExp),
    reason: zod.string().min(1).max(teamsPutAustrittBodyReasonMax).regex(teamsPutAustrittBodyReasonRegExp),
    type: zod.enum(["disqualifikation", "rueckzug"]),
  })
  .describe(
    "The exit as an administrator writes it: the reason ceilinged as it arrives and stripped before its floor.\n\nOn the WRITE side alone, so a read model takes a stored blank or a longer reason as it stands.",
  );

/**
 * Stamp this team's live registration link revoked, so it opens nothing from here on.
 *
 * The row stays: a delivery event about a message carrying that link still has somewhere to land, and a reissue's history is what says
 * which link a bounce was about. 404 where the team holds no live link for the season; a link of a season that has ended stays revocable.
 * @summary Revoke this team's live registration link for a season
 */
export const teamsDeleteInvitationPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsDeleteInvitationParams = zod.object({
  team_id: zod.string().regex(teamsDeleteInvitationPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Mint the link a team's players register through, revoking whatever link that team held for this season.
 *
 * **The raw link value is in this answer and in no other, ever**: the row stores an unkeyed SHA-256 of it, so a link nobody copied out of
 * this response is lost and the repair is another mint. Mailing the team's link is a separate press
 * (`POST /teams/{team_id}/saisons/{saison_id}/invitation/dispatch`), whose mails mint links of their own beside this one.
 *
 * The reissue is part of the same transaction, so the previous link stops opening anything the moment this answers, and the team is left
 * holding exactly one live invitation. The link carries no date: it expires with the season's registration window, which is judged afresh
 * every time somebody opens it, so a window moved after the mint moves this link with it.
 *
 * Refused where the season holds no junction row for this team (`invitation_team_not_entered`) and where the season has ended
 * (`saison_past`); a `future` season mints, the links being prepared before the window opens. 404 where no season holds that id.
 *
 * A row whose exit stands is refused `version_stale`, the page offering this press having been read before the exit: its team's link
 * opens nothing, whoever holds it.
 * @summary Mint this team's registration link for a season
 */
export const teamsPostInvitationPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPostInvitationParams = zod.object({
  team_id: zod.string().regex(teamsPostInvitationPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Owe this team's live registration link to every seat of its season row whose own person has confirmed it, one mail each.
 *
 * The write mints nothing and revokes nothing: each mail mints a link of its own when it is handed out, so a link copied off the mint
 * stays valid beside the mailed ones. `recipient` names who is owed it, one entry per stored address, and is empty where nobody has
 * confirmed a seat, which owes nothing. Where it owes anyone, the row's `sent_at` becomes today, the day the season editor shows. Pressed
 * twice on one day, the second owes nothing again; a later day's press mails the seats afresh. A barred address is stopped when its mail
 * is handed out.
 *
 * 404 where `invitation_id` is not this team's live invite for the season, a link replaced or withdrawn since the caller read it among
 * them, and where the season holds no row for the team. A row whose exit stands is refused `version_stale`, as the mint refuses it.
 * @summary Mail this team's live registration link to its confirmed contact seats
 */
export const teamsPostInvitationDispatchPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPostInvitationDispatchParams = zod.object({
  team_id: zod.string().regex(teamsPostInvitationDispatchPathTeamIdRegExp),
  saison_id: zod.string(),
});

export const teamsPostInvitationDispatchBodyInvitationIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPostInvitationDispatchBody = zod
  .object({
    invitation_id: zod.string().regex(teamsPostInvitationDispatchBodyInvitationIdRegExp),
  })
  .describe("The one live link a team's panel shows, to be mailed to the team's confirmed seats.");

/**
 * „Sitz bearbeiten“: write the person into one seat, judged by the seat's state, on the row's `version`.
 *
 * The same person, the address and name folded, keeps the seat's record and link, so a corrected number mails nobody and
 * `email` answers null. Anyone else takes the seat unconfirmed, a confirmed person giving way, and is owed a fresh link
 * in this write's own transaction, the answer naming the address; an emptied seat is filled the same way. The seat's
 * last holder loses their links on the team's open match confirmations. A `past` season's seats and a departed team's
 * stay correctable, and such a link takes the person's Widerspruch alone.
 *
 * Where the Trainer holds a second seat, a write on either seat writes both, under one link. `trainer_is_also` is read
 * on the Trainer's seat alone: sent, it replaces the claim, and the seat it names takes this person; null ends the
 * claim, and the seat it named keeps its person. Left out, the claim stands.
 *
 * Refused `version_stale` on a row moved since the read, `kontakt_email_taken` and `kontakt_phone_taken` where another
 * seat's person holds the address or the number, and `kontakt_seat_barred` where the ban list holds the address of a
 * person newly seated. 404 for a team and season holding no row, and for a path naming no seat.
 * @summary Write the person one contact seat holds
 */
export const teamsPutKontaktSeatPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPutKontaktSeatParams = zod.object({
  team_id: zod.string().regex(teamsPutKontaktSeatPathTeamIdRegExp),
  saison_id: zod.string(),
  seat: zod.string(),
});

export const teamsPutKontaktSeatBodyEmailMax = 254;

export const teamsPutKontaktSeatBodyFirstNameMax = 80;

export const teamsPutKontaktSeatBodyFirstNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPutKontaktSeatBodyLastNameMax = 80;

export const teamsPutKontaktSeatBodyLastNameRegExp = new RegExp("^\\p{L}[\\p{L}\\-' ]*$", "u");
export const teamsPutKontaktSeatBodyPhoneRegExp = new RegExp("^([+]?[ 0-9\\-().]{2,19}[0-9])$");
export const teamsPutKontaktSeatBodyVersionMin = 0;

export const TeamsPutKontaktSeatBody = zod
  .object({
    email: zod.string().max(teamsPutKontaktSeatBodyEmailMax),
    first_name: zod.string().min(1).max(teamsPutKontaktSeatBodyFirstNameMax).regex(teamsPutKontaktSeatBodyFirstNameRegExp),
    last_name: zod.string().min(1).max(teamsPutKontaktSeatBodyLastNameMax).regex(teamsPutKontaktSeatBodyLastNameRegExp),
    phone: zod.string().regex(teamsPutKontaktSeatBodyPhoneRegExp),
    trainer_is_also: zod.union([zod.enum(["ansprechperson", "stellvertretung"]), zod.null()]).optional(),
    version: zod.int().min(teamsPutKontaktSeatBodyVersionMin),
  })
  .describe("The person one seat is to hold, on the row's `version` the dialog read, who has agreed to nothing yet.");

/**
 * Owe one contact seat a fresh confirmation link, mailed through the Postausgang in this write's own transaction.
 *
 * It replaces the seat's link WHOLE, and its pair's where the Trainer holds both and has not confirmed the other:
 * the previous link stops opening anything from this write on, and the deadline restarts from today. The answer names
 * the address the mail is owed to, never the link.
 *
 * Refused where the season has ended or the team has left it (`kontakt_row_without_saison`), where the seat holds nobody or its
 * person has already confirmed it (`kontakt_seat_without_confirmation`), and where its address is on the ban list (`kontakt_seat_barred`).
 * 404 for a team and season holding no row, and for a path naming no seat.
 * @summary Send one contact seat a fresh confirmation link
 */
export const teamsInviteKontaktPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsInviteKontaktParams = zod.object({
  team_id: zod.string().regex(teamsInviteKontaktPathTeamIdRegExp),
  saison_id: zod.string(),
  seat: zod.string(),
});

/**
 * Hand this season's junction row, and every fixture on it, to another club.
 *
 * Its `team_id`, identity copy and every fixture side move, its `austritt`, colour, contacts and
 * their links are cleared, and the outgoing club's live squad rows are retired, in ONE transaction:
 * the schedule survives.
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
 * The team's three seats in this season, each with its holder's name and whether that person has confirmed it.
 *
 * Always three lines, an empty slot answered with no name. No seat's address, telephone number, birthdate or
 * confirmation date is served, whoever asks.
 * @summary A team's seats in one season
 */
export const teamsGetTeamSeatsPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamSeatsParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamSeatsPathTeamIdRegExp),
  saison_id: zod.string(),
});
