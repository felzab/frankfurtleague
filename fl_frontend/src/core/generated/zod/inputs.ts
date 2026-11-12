import "server-only";

import * as zod from "zod";

/**
 * Start a change of the address the person signs in on: the address on file is mailed a link, and its confirmation mails the new one.
 *
 * Everything the address holds moves once the new address confirms, after a wait where it holds a grant; declining
 * either link ends the change, and a live change of the address is replaced.
 * @summary Start a change of the signed-in person's address
 */
export const accountPostAddressChangeBodyEmailMax = 254;

export const AccountPostAddressChangeBody = zod.object({
  email: zod.string().max(accountPostAddressChangeBodyEmailMax),
});

/**
 * The newest 50 acts the filters keep, starting after `cursor` where one is given.
 * @summary List recorded acts
 */
export const actionLogGetActionLogBodyByOneMax = 254;

export const actionLogGetActionLogBodyCursorOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const actionLogGetActionLogBodyQOneMax = 200;

export const actionLogGetActionLogBodyTypeOneMax = 17;

export const ActionLogGetActionLogBody = zod
  .object({
    by: zod.union([zod.string().max(actionLogGetActionLogBodyByOneMax), zod.null()]).optional(),
    cursor: zod.union([zod.string().regex(actionLogGetActionLogBodyCursorOneRegExp), zod.null()]).optional(),
    from_day: zod.union([zod.iso.date(), zod.null()]).optional(),
    q: zod.union([zod.string().max(actionLogGetActionLogBodyQOneMax), zod.null()]).optional(),
    type: zod
      .union([
        zod
          .array(
            zod.enum([
              "saison",
              "spieltag",
              "spiel",
              "spielbestaetigung",
              "spielbericht",
              "aufstellung",
              "team",
              "bewerbung",
              "registrierung",
              "spieler",
              "schiedsrichter",
              "spielort",
              "grant",
              "ban",
              "address_change",
              "erasure",
              "retention",
            ]),
          )
          .max(actionLogGetActionLogBodyTypeOneMax),
        zod.null(),
      ])
      .optional(),
  })
  .describe("What the action log's read narrows by.");

/**
 * Start a change of the typed address for a person who says they cannot sign in.
 *
 * The new mailbox is mailed a link and the address on file a stop link, and nothing moves until a waiting period after
 * the new mailbox confirms, the old address working until then.
 * @summary Start an address change for a person who says they cannot sign in
 */
export const addressChangePostAddressChangeAdminBodyAddressMax = 254;

export const addressChangePostAddressChangeAdminBodyEmailMax = 254;

export const AddressChangePostAddressChangeAdminBody = zod
  .object({
    address: zod.string().max(addressChangePostAddressChangeAdminBodyAddressMax),
    email: zod.string().max(addressChangePostAddressChangeAdminBodyEmailMax),
  })
  .describe("The address a change starts on, and the address it goes to.");

/**
 * The new address, folded, of the live change a new-mailbox link token or a change id names.
 *
 * A token or id naming no live change is answered null rather than refused, so a lapsed or answered link costs no error.
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
  .describe("Exactly one key: the new mailbox's link token, or the change a re-send names.");

/**
 * Record whether the mailbox this link was sent to is the person's: `confirmed` confirms it, `declined` ends the change.
 *
 * The new mailbox's confirmation moves everything the address holds unless the change waits, as `effective` and
 * `effective_from` say; the address on file's confirmation of the person's own change only mails the new mailbox its link.
 * @summary Confirm or decline a pending address
 */
export const addressChangePostAddressChangeAnswerBodyTokenMax = 128;

export const addressChangePostAddressChangeAnswerBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const AddressChangePostAddressChangeAnswerBody = zod.object({
  answer: zod.enum(["confirmed", "declined"]),
  token: zod.string().min(1).max(addressChangePostAddressChangeAnswerBodyTokenMax).regex(addressChangePostAddressChangeAnswerBodyTokenRegExp),
});

/**
 * Stop the change the address on file was mailed about, its new address going, at any time until the change ends.
 *
 * The person's own change offers this link no stop until its address on file confirmed it.
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
 * What this token opens: the new mailbox's link, the link the address on file was mailed, or how either's change ended.
 *
 * Each side is served in the state its press would meet, and an ended change's links answer for as long as its record
 * is kept.
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
 * End a share of the changes whose step lapsed, and make each due one take effect, or end it where its judgement now refuses it.
 *
 * A pass is a run of calls, each handing the next the `after` the last answered, ending at the call answering `after`
 * null; `remaining` is no stopping condition.
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
 * Discard the change this id names, the address on file staying.
 *
 * A holder's change in its wait tells every holder, and nobody else is mailed.
 * @summary Discard a pending address change
 */
export const addressChangeDeleteAddressChangePathAddressChangeIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangeDeleteAddressChangeParams = zod.object({
  address_change_id: zod.string().regex(addressChangeDeleteAddressChangePathAddressChangeIdRegExp),
});

/**
 * Mail the new mailbox a fresh link for the change this id names, its deadline restarting now.
 *
 * The previous link stops working once the fresh one is handed out, and only a change waiting on the new mailbox has a
 * link to re-send.
 * @summary Send a pending address a fresh link
 */
export const addressChangeInviteAddressChangePathAddressChangeIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AddressChangeInviteAddressChangeParams = zod.object({
  address_change_id: zod.string().regex(addressChangeInviteAddressChangePathAddressChangeIdRegExp),
});

/**
 * The line-up screen of one club for one fixture, as the club's own seat holders read it.
 * @summary One club's line-up for one fixture as an administrator reads it
 */
export const aufstellungenGetAufstellungPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const aufstellungenGetAufstellungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AufstellungenGetAufstellungParams = zod.object({
  spiel_id: zod.string().regex(aufstellungenGetAufstellungPathSpielIdRegExp),
  team_id: zod.string().regex(aufstellungenGetAufstellungPathTeamIdRegExp),
});

/**
 * Save the whole line-up of one club for one fixture at any time, the hour before kick-off included.
 *
 * An entry naming nobody stands for a pupil erased after the match was played, and a save keeps it by sending it back.
 * @summary Save one club's line-up for one fixture as an administrator
 */
export const aufstellungenPutAufstellungPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const aufstellungenPutAufstellungPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AufstellungenPutAufstellungParams = zod.object({
  spiel_id: zod.string().regex(aufstellungenPutAufstellungPathSpielIdRegExp),
  team_id: zod.string().regex(aufstellungenPutAufstellungPathTeamIdRegExp),
});

export const aufstellungenPutAufstellungBodySpielerItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const aufstellungenPutAufstellungBodySpielerMax = 60;

export const aufstellungenPutAufstellungBodyVersionOneMin = 0;

export const AufstellungenPutAufstellungBody = zod
  .object({
    spieler: zod
      .array(
        zod
          .object({
            spieler_id: zod.union([zod.string().regex(aufstellungenPutAufstellungBodySpielerItemSpielerIdOneRegExp), zod.null()]),
            starts: zod.boolean(),
          })
          .describe(
            "One pupil a club fields in one match: on the pitch from the start, or on the bench.\n\nA null `spieler_id` names nobody: a pupil erased after the match was played, whose place in it stands.",
          ),
      )
      .max(aufstellungenPutAufstellungBodySpielerMax),
    version: zod.union([zod.int().min(aufstellungenPutAufstellungBodyVersionOneMin), zod.null()]),
  })
  .describe("A club's whole line-up for one fixture, written wholesale.");

/**
 * The line-up screen of one club for one fixture, for a person holding any contact seat on that club in the fixture's season.
 *
 * A finished season grants no seat, so its line-ups are an administrator's to read.
 * @summary One club's line-up for one fixture as its seat holder reads it
 */
export const aufstellungenGetAufstellungSelfPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const aufstellungenGetAufstellungSelfPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AufstellungenGetAufstellungSelfParams = zod.object({
  spiel_id: zod.string().regex(aufstellungenGetAufstellungSelfPathSpielIdRegExp),
  team_id: zod.string().regex(aufstellungenGetAufstellungSelfPathTeamIdRegExp),
});

/**
 * Save the whole line-up of one club for one fixture, as any contact seat of the club may until one hour before kick-off.
 *
 * A line-up being due or overdue refuses nothing, and `version` is the document's as the screen was served it, null
 * where the screen showed no line-up.
 * @summary Save one club's line-up for one fixture as its seat holder
 */
export const aufstellungenPutAufstellungSelfPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const aufstellungenPutAufstellungSelfPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const AufstellungenPutAufstellungSelfParams = zod.object({
  spiel_id: zod.string().regex(aufstellungenPutAufstellungSelfPathSpielIdRegExp),
  team_id: zod.string().regex(aufstellungenPutAufstellungSelfPathTeamIdRegExp),
});

export const aufstellungenPutAufstellungSelfBodySpielerItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const aufstellungenPutAufstellungSelfBodySpielerMax = 60;

export const aufstellungenPutAufstellungSelfBodyVersionOneMin = 0;

export const AufstellungenPutAufstellungSelfBody = zod
  .object({
    spieler: zod
      .array(
        zod
          .object({
            spieler_id: zod.union([zod.string().regex(aufstellungenPutAufstellungSelfBodySpielerItemSpielerIdOneRegExp), zod.null()]),
            starts: zod.boolean(),
          })
          .describe(
            "One pupil a club fields in one match: on the pitch from the start, or on the bench.\n\nA null `spieler_id` names nobody: a pupil erased after the match was played, whose place in it stands.",
          ),
      )
      .max(aufstellungenPutAufstellungSelfBodySpielerMax),
    version: zod.union([zod.int().min(aufstellungenPutAufstellungSelfBodyVersionOneMin), zod.null()]),
  })
  .describe("A club's whole line-up for one fixture, written wholesale.");

/**
 * Ban an address: it cannot sign in, and no mail leaves for it but the ban's own notice, sent where `notify` is set.
 *
 * The ban runs a fixed number of seasons past the running one, and it and its reason outlive the person's erasure.
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
 * Lift a ban before it lapses, deleting its row for good.
 * @summary Lift a ban
 */
export const banListDeleteBanListEntryPathBanListEntryIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BanListDeleteBanListEntryParams = zod.object({
  ban_list_entry_id: zod.string().regex(banListDeleteBanListEntryPathBanListEntryIdRegExp),
});

/**
 * Store one school's application to play one season, and mail each contact person their confirmation link, one per person.
 *
 * A second press with an `Idempotency-Key` already stored answers the application that key holds and stores nothing.
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
 * Record one person's consent or Widerspruch for the seat their link opens, and for a second seat they hold.
 *
 * A Widerspruch empties the slot, and on an application it tells the Ansprechperson who still stands, in a notice that
 * is the deletion notice too.
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
 * A confirmed, declined or expired link is served in that state; only a token no seat holds is refused.
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
 * A season's application window, and while it runs the clubs a school may apply as and the colours taken.
 *
 * A closed or paused window and a season recording none are served too, and each club is served as its name alone.
 * @summary What one Saison's application form shows
 */
export const BewerbungenGetFormParams = zod.object({
  saison_id: zod.string(),
});

/**
 * The season's applications, newest first, holding nothing of a person, and what an acceptance would meet there.
 *
 * A long list is cut, as `complete` says, but every application with a confirmed seat is served past the cut.
 * @summary One Saison's Bewerbungen for its list
 */
export const BewerbungenGetBewerbungenAdminQueryParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Run one season's retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.
 *
 * A row that cannot be written is passed over, counted in `failed`, and met again by the next pass.
 * @summary Run one season's retention clocks
 */
export const BewerbungenSweepSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One application, each seat's state judged today and `duplicate` taken over every open application of the season.
 * @summary One Bewerbung for its review page
 */
export const bewerbungenGetBewerbungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenGetBewerbungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenGetBewerbungPathBewerbungIdRegExp),
});

/**
 * Accept an application once every contact person confirmed their seat, entering its club into the season and creating it for a new school.
 *
 * It cannot be undone, as an entered club leaves only by an `austritt`, and every person of the application is mailed
 * the acceptance.
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
 * Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application; a grant is refused.
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
 * Decline an application with the reason given, mailed verbatim to each person the application mailed.
 *
 * What the school submitted stays as it was, the record the decision was taken against.
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
 * Void one seat's link and mail its person a fresh one, that seat's deadline and reminder starting again from today.
 *
 * Where one person holds two seats both are replaced and one link answers both, and the answer names the address and
 * seats as the write found them.
 * @summary Re-send one seat's confirmation link
 */
export const bewerbungenResendEinwilligungPathBewerbungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const BewerbungenResendEinwilligungParams = zod.object({
  bewerbung_id: zod.string().regex(bewerbungenResendEinwilligungPathBewerbungIdRegExp),
  seat: zod.string(),
});

/**
 * Write a person into one seat, whatever its state, and mail them a fresh link; an acceptance waits on their answer.
 *
 * Where one person holds two seats both are written, the last holder's link opens nothing afterwards, and the seat's
 * deadline starts again from today.
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
 * Add an address as `administration`, holding once its wait has passed; only the owner adds one, and no request grants `owner`.
 *
 * Every holder in effect and the address named are told, with the date it holds from.
 * @summary Add an administrator
 */
export const grantsPostGrantBodyEmailMax = 254;

export const GrantsPostGrantBody = zod.object({
  email: zod.string().max(grantsPostGrantBodyEmailMax),
});

/**
 * Remove a grant for good, its address losing access on its next request, or withdraw an addition still waiting.
 *
 * Only the owner removes one, the owner's own row leaving only by a handover; every holder in effect and the address named are told.
 * @summary Remove an administrator, or withdraw a waiting addition
 */
export const grantsDeleteGrantPathGrantIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsDeleteGrantParams = zod.object({
  grant_id: zod.string().regex(grantsDeleteGrantPathGrantIdRegExp),
});

/**
 * Stop a waiting handover, the role staying with the owner; only the owner stops one, and every holder in effect is told.
 * @summary Stop a waiting handover
 */
export const grantsDeleteHandoverPathGrantIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsDeleteHandoverParams = zod.object({
  grant_id: zod.string().regex(grantsDeleteHandoverPathGrantIdRegExp),
});

/**
 * Start handing the owner role to an administrator in effect, completing once its wait has passed; the owner stays the owner until then.
 *
 * Only the owner starts one, and every holder in effect is told the date it completes on.
 * @summary Hand the owner role over to an administrator
 */
export const grantsPostHandoverPathGrantIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const GrantsPostHandoverParams = zod.object({
  grant_id: zod.string().regex(grantsPostHandoverPathGrantIdRegExp),
});

/**
 * Erase every record an address holds, on a request that person made by mail, at once and as one write, as their own erasure does.
 *
 * Nothing about the person's own state refuses it, and the sign-in account is the caller's to delete once this has answered.
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
  .describe("The mailbox, and the reference to the request the erasure answers, free text the log's row keeps.");

/**
 * Delete a bounded share of the pupils whose last squad season is over by a whole season, and answer what went and how many remain.
 *
 * A pass is a run of calls, each handing the next the `after` the last answered, and it ends at the call answering
 * `after` null; `remaining` counts the pupils still due, the failed among them, so it is no stopping condition.
 * @summary Delete one share of the pupils the season-after rule makes due
 */
export const identitySweepErasureQueryAfterOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const IdentitySweepErasureQueryParams = zod.object({
  after: zod.union([zod.string().regex(identitySweepErasureQueryAfterOneRegExp), zod.null()]).optional(),
});

/**
 * Count what `POST /identity/erasure` would remove or empty for this address, by kind, naming nothing and storing nothing.
 *
 * It is refused as that erasure is, and leaves out of `address_change` a grant holder's change this administrator may not see.
 * @summary Count what an erasure of an address would remove
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
  .describe("The mailbox an erasure or its counts are looked up by.");

/**
 * Answer which of these sign-in addresses no league record references, each once and in the spelling it was asked in.
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
 * Answer which confirmed, live contact seats, pupil records and referee records one mailbox holds, with its grant.
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
 * Record what the mail provider reported about one message on its mail's row, where the row's state may follow into it.
 *
 * A redelivered or out-of-order event changes nothing, and a delivery of a mail about an application reopens the
 * closed chase of every seat holding its address.
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
 * Settle the named mail by its send's outcome where the named claim still holds it, counting a mail it does not hold in `ignored`.
 *
 * `held` reports a deployment that sends no mail, `abandon` a refusal every send would meet (any 4xx but a 429), and
 * `retry` a 429, a 5xx or a send that never reached the provider, which hands the mail back unless it is a sign-in
 * mail or past its deadline.
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
 * Owe one mail the sign-in library sends, such as a code, a passkey notice or the deletion link, to the address named.
 *
 * `secret` is stored as it arrives and dropped once the mail is settled; `valid_until` is both the last moment a send
 * may happen and when the row is deleted.
 * @summary Owe one mail of the sign-in library
 */
export const outboxPostSignInBodySecretOneMax = 4096;

export const outboxPostSignInBodyToMax = 254;

export const OutboxPostSignInBody = zod
  .object({
    data: zod.union([
      zod.object({
        kind: zod.literal("sign_in_code").meta({ title: "Kind" }),
      }),
      zod.object({
        instant: zod.iso.datetime({ offset: true }),
        kind: zod.enum(["passkey_added", "passkey_erased"]),
      }),
      zod.object({
        kind: zod.literal("account_erasure").meta({ title: "Kind" }),
      }),
      zod
        .object({
          kind: zod.literal("deletion_notice").meta({ title: "Kind" }),
          saison_id: zod.union([zod.string(), zod.null()]),
        })
        .describe("The one deletion notice, to a person who confirmed what went: an application's owed by a league write, an account's here."),
    ]),
    secret: zod.union([zod.string().min(1).max(outboxPostSignInBodySecretOneMax), zod.null()]),
    to: zod.string().max(outboxPostSignInBodyToMax),
    valid_until: zod.union([zod.iso.datetime({ offset: true }), zod.null()]),
  })
  .describe("One mail of the sign-in library, owed to the address it names.");

/**
 * Store one pupil's registration for the team and season the link belongs to, and owe its confirmation mail.
 *
 * A press repeating a stored `Idempotency-Key` answers the registration the first one stored, whatever its body says,
 * and owes no second mail.
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
 * A grant is refused, and a request moving neither choice writes nothing.
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
 * @summary Confirm one registration and record the pupil's consent
 */
export const registrierungenPostConfirmationBodyBirthDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const registrierungenPostConfirmationBodyTokenMax = 128;

export const registrierungenPostConfirmationBodyTokenRegExp = new RegExp("^[^\\x00\\n\\v\\f\\r\\u0085\\u2028\\u2029]*$");

export const RegistrierungenPostConfirmationBody = zod
  .object({
    birth_date: zod.string().regex(registrierungenPostConfirmationBodyBirthDateRegExp),
    media: zod.boolean(),
    scope: zod.enum(["kader_public", "internal"]),
    text_versions: zod
      .object({
        media: zod.literal("2026-11-medien-1"),
        scope: zod.literal("2026-11-name-kader-1"),
      })
      .describe("A pupil's two wordings: the name on the squad and the media switch."),
    token: zod.string().min(1).max(registrierungenPostConfirmationBodyTokenMax).regex(registrierungenPostConfirmationBodyTokenRegExp),
  })
  .describe("One pupil's own answer: their date of birth and the two consents.");

/**
 * What the registration this confirmation link opens shows, and nothing of the pupil but the day they answered.
 *
 * A confirmed or expired link is served in that state, and a link whose club has left the season reads expired.
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
 * A paused or ended window is a state here, so such a link reads as closed rather than as invalid.
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
 * Every pending registration of this team's season, newest first, each marked by whether its pupil confirmed it.
 *
 * A confirmed row names the stored person its address resolves to, flagged where their name or birthdate differs,
 * `kader_full` marks a row whose admission would meet the squad's cap, and no address, telephone number, birthdate or
 * consent record is served for anybody.
 * @summary A team's pending registrations for one season
 */
export const registrierungenGetOpenRegistrierungenPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const RegistrierungenGetOpenRegistrierungenParams = zod.object({
  team_id: zod.string().regex(registrierungenGetOpenRegistrierungenPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * One season's pending registrations, newest first, each with its club and whether its pupil confirmed it.
 *
 * `unmailed` marks a row owed no mail, its mailbox already holding the most open links, and `complete` says whether
 * the read's cap cut the list.
 * @summary One Saison's pending Registrierungen for its list
 */
export const RegistrierungenGetRegistrierungenAdminQueryParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Erase one season's due registrations, as of today in Europe/Berlin.
 *
 * A declined one goes once its wait after the decision has run out, an unconfirmed one past its deadline, and every one
 * still undecided once the season is `past`; one whose erasure fails is counted in `failed` and met again next pass.
 * @summary Run one season's registration retention clocks
 */
export const RegistrierungenSweepRegistrierungenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Admit one confirmed registration: the person holding its address, or a new one, joins the team's squad.
 *
 * `spieler_id` names that person where their name or birthdate differs and is null where nobody holds the address;
 * the registration and every other pending one of its address this season are erased, and nobody is mailed.
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
 * Decline one pending registration, confirmed or not, for a reason from a closed set or none.
 *
 * A pupil who confirmed their address is mailed the decision; an unconfirmed address may be a stranger's, and is
 * mailed nothing.
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
 * Its id follows the newest stored season's and its rules carry on from it, its two windows start closed, and a league
 * holds at most one planned season.
 * @summary Create a Saison
 */
export const saisonsPostSaisonBodyEndDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const saisonsPostSaisonBodyStartDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");

export const SaisonsPostSaisonBody = zod.object({
  end_date: zod.string().regex(saisonsPostSaisonBodyEndDateRegExp),
  start_date: zod.string().regex(saisonsPostSaisonBodyStartDateRegExp),
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
 * Save a season's dates and rules on the `version` it was read at, answering the version stored.
 *
 * What a started or drawn season has fixed is refused, as is a rule narrowed below what it holds; the start date is
 * fixed once a fixture has taken place, and moves later only while no club's exit is stored.
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
export const saisonsPatchSaisonBodyRulesMaxKaderSizeMax = 50;

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
        "When a pupil's entry is an ordinary one: from the season's activation to `end`, which falls before the season's start.\n\nPast `end` the link runs on until the season ends and an entry is a Nachnominierung; `open` pauses the link alone.",
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
        "What a fixture is awarded when one side does not appear, as both sides' goals rather than a margin.\n\nA level award needs a season with no knockout round.",
      ),
    loss_points: zod.int().min(saisonsPatchSaisonBodyRulesLossPointsMin),
    max_kader_size: zod.int().gt(saisonsPatchSaisonBodyRulesMaxKaderSizeExclusiveMin).max(saisonsPatchSaisonBodyRulesMaxKaderSizeMax),
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
 * Make this the active season, moving whichever holds `active` to `past`.
 *
 * The outgoing season must be finished, and every matchday of the target dated.
 * @summary Make this the active Saison
 */
export const SaisonsActivateSaisonParams = zod.object({
  saison_id: zod.string(),
});

/**
 * What the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.
 *
 * The season is served a `future` one included, and every flag and every refusal is judged as the write it stands for
 * judges it, so an act is offered exactly where its write takes it.
 * @summary One Saison for the admin editor
 */
export const SaisonsGetSaisonAdminParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Exchange the groups of two clubs entered in this season, as one write.
 *
 * Every group fixture fielding either club has that side rewritten with it, so each group stays a round robin; neither
 * `tore` nor `austritt` moves.
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
    "The two clubs a group swap exchanges, in either order.\n\nNeither side carries a `gruppe`: reading one from the payload would let a stale form write a\ngroup nobody stands in.",
  );

/**
 * Give every admitted team of this season a fresh registration link, revoking any it held, mailed to its confirmed seats.
 *
 * A team that has left the season, holds no confirmed seat or was already sent its live link is skipped and left as it
 * was, so pressing twice mails nobody twice.
 * @summary Mint every admitted team a link
 */
export const SaisonsPostInvitationsDispatchParams = zod.object({
  saison_id: zod.string(),
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
 * The administrator's Übersicht for one season: its open work on the cards `due`, `ergebnisse`, `dates` and `bewerbungen`.
 *
 * Every card is served, an empty one included, and each row carries what its act needs, the fixture with its `version`
 * among it.
 * @summary One Saison's open work, card by card
 */
export const SaisonsGetSaisonOverviewParams = zod.object({
  saison_id: zod.string(),
});

/**
 * One match as its page and its pop-up show it, each side of a group match with its group and `platz`; 404 outside a readable season.
 *
 * Each side's line-up from the moment its club stores one, the scorers and cards only while the report is adopted
 * and unchanged since, every pupil through the public mask.
 * @summary One Spiel's page
 */
export const saisonsGetSpielPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SaisonsGetSpielParams = zod.object({
  saison_id: zod.string(),
  spiel_id: zod.string().regex(saisonsGetSpielPathSpielIdRegExp),
});

/**
 * Return the season to undrawn: its matchdays and fixtures, their confirmations, reports and line-ups, and the draw's day.
 *
 * Undoing the draw reopens the shape rules to an edit and the groups to an entry.
 * @summary Undraw this Saison's Spielplan
 */
export const SaisonsDeleteSpielplanParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Every matchday of one season with its matches, in playing order, and the matchday to open on.
 *
 * 404 for a season this tier may not read.
 * @summary One Saison's Spielplan
 */
export const SaisonsGetSpielplanParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Draw the whole season at once, every matchday and every fixture undated, from the stated `shape` or the season's rules.
 *
 * A stated `shape` is stored in the rules, and `replace` first deletes what a planned season holds, its fixtures'
 * confirmations, reports and line-ups with it; nothing writes the removed rows back.
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
    "Whether this draw may replace what the season already holds, and the shape it runs from.\n\nAn absent body is a first draw off the season's own rules: nothing is destroyed and no\nnumber moves by omission.",
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
 * Every referee in name order, retired ones included where `include_inactive` asks, since a played match still names them.
 * @summary List Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichterQueryIncludeInactiveDefault = false;

export const SchiedsrichterGetSchiedsrichterQueryParams = zod.object({
  include_inactive: zod.boolean().default(schiedsrichterGetSchiedsrichterQueryIncludeInactiveDefault),
});

/**
 * Create a referee and owe them their confirmation link, answering the address and the deadline it goes to.
 *
 * Entering a referee is the invitation, with no second press deciding whether they are asked, since a referee nobody
 * asked is a name nobody consented to publish.
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
 * The public fixture list reads the scope off this row, so the caller drops its cached copy after a successful answer.
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
 * The caller drops the cached fixture list after a successful answer, or a withheld name goes on being served for as
 * long as that entry lives.
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
 * The entry is erased at the midnight after its link's deadline, and until then no booking takes it and nobody asks
 * the person again.
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
 * What this token opens: the link's state and deadline, the age bounds and the day of the person's own answer.
 *
 * A confirmed or an expired link is served in that state rather than refused, so a reopened link shows what became of it.
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
 * Every fixture of this season booked to one of the signed-in address's live, confirmed referee records, open work first.
 *
 * Nobody's address is served, and no reason an administrator entered.
 * @summary A signed-in referee's fixtures of one season, one row a fixture
 */
export const SchiedsrichterGetSelfSpieleParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Deactivate a referee, who stays on record because a played match names them by id.
 *
 * Refused while a fixture still to be played books them.
 * @summary Deactivate a Schiedsrichter (soft delete)
 */
export const schiedsrichterDeleteSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterDeleteSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterDeleteSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * One referee, a retired one included, with whether their consent link has lapsed today and what became of their last confirmation mail.
 *
 * An erased referee's id answers 404.
 * @summary One Schiedsrichter
 */
export const schiedsrichterGetSchiedsrichterByIdPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterGetSchiedsrichterByIdParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterGetSchiedsrichterByIdPathSchiedsrichterIdRegExp),
});

/**
 * Update a referee on the `version` the editor was served, answering the version stored.
 *
 * A corrected address on an unconfirmed referee retires their link and owes a fresh one, named in `confirmation`, and a
 * confirmed referee's address moves only through an address change.
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
 * The previous link stops working at once and the deadline restarts from today; a referee who has already answered is
 * refused, since the new link could never be spent.
 * @summary Send a Schiedsrichter a fresh confirmation link
 */
export const schiedsrichterInviteSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterInviteSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterInviteSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * Bring a retired referee back into the picker and every default read.
 *
 * One who has not answered is owed a fresh link, named in `confirmation`, since a retired referee's save mails nothing.
 * @summary Bring a deactivated Schiedsrichter back
 */
export const schiedsrichterReactivateSchiedsrichterPathSchiedsrichterIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SchiedsrichterReactivateSchiedsrichterParams = zod.object({
  schiedsrichter_id: zod.string().regex(schiedsrichterReactivateSchiedsrichterPathSchiedsrichterIdRegExp),
});

/**
 * What the booked referee's report form reads: the fixture, both clubs' live squads, and the stored report or null.
 *
 * Where `reportable` is false or `completed` true, both squads are empty and every pupil the report names is in `named`.
 * @summary One fixture's report as its referee reads it
 */
export const spielberichteGetSpielberichtBerichtPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichteGetSpielberichtBerichtParams = zod.object({
  spiel_id: zod.string().regex(spielberichteGetSpielberichtBerichtPathSpielIdRegExp),
});

/**
 * Write the whole report of one fixture as its booked referee, replacing what stood, and never the fixture's result.
 *
 * A write changing the report clears its adoption, and `version` is the report document's as the form was served it,
 * null where the form showed no report.
 * @summary Write one fixture's report as its referee
 */
export const spielberichtePutSpielberichtBerichtPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielberichtePutSpielberichtBerichtParams = zod.object({
  spiel_id: zod.string().regex(spielberichtePutSpielberichtBerichtPathSpielIdRegExp),
});

export const spielberichtePutSpielberichtBerichtBodyBerichtCardsItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePutSpielberichtBerichtBodyBerichtCardsItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePutSpielberichtBerichtBodyBerichtCardsMax = 60;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam1Min = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtErgebnisVorschlagElfmeterschiessenOneTeam2Min = 0;

export const spielberichtePutSpielberichtBerichtBodyBerichtRemarksOneMax = 2000;

export const spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp = new RegExp("^[0-9]{1,3}(\\+[0-9]{1,2})?$");
export const spielberichtePutSpielberichtBerichtBodyBerichtScorersItemSpielerIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
export const spielberichtePutSpielberichtBerichtBodyBerichtScorersMax = 60;

export const spielberichtePutSpielberichtBerichtBodyVersionOneMin = 0;

export const SpielberichtePutSpielberichtBerichtBody = zod
  .object({
    bericht: zod.object({
      cards: zod
        .array(
          zod
            .object({
              colour: zod.enum(["gelb", "gelb_rot", "rot"]),
              minute: zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtCardsItemMinuteRegExp),
              side: zod.enum(["team1", "team2"]),
              spieler_id: zod.union([
                zod.string().regex(spielberichtePutSpielberichtBerichtBodyBerichtCardsItemSpielerIdOneRegExp),
                zod.null(),
              ]),
            })
            .describe("One card as the referee's save sends it: a key the card does not declare is refused, never dropped."),
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
              .describe("A shoot-out as a save sends it: a key beside the two counts is refused, never dropped."),
            zod.null(),
          ]),
          sonderereignis: zod.union([zod.enum(["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"]), zod.null()]),
        })
        .describe("What the referee proposes beside the goals: a shoot-out, or the event the match ended in."),
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
            .describe("One goal as the referee's save sends it: a key the goal does not declare is refused, never dropped."),
        )
        .max(spielberichtePutSpielberichtBerichtBodyBerichtScorersMax),
    }),
    version: zod.union([zod.int().min(spielberichtePutSpielberichtBerichtBodyVersionOneMin), zod.null()]),
  })
  .describe("The whole `bericht` block, written wholesale by the referee's PUT.");

/**
 * Close, mint and remind one season's fixture confirmations as of today, owing each mail with its row, and answer what it did, counted.
 *
 * Each step takes a bounded share and leaves the rest due, and a season that is not `active` is passed by whole.
 * @summary Run one season's fixture confirmation pass
 */
export const SpielbestaetigungenSweepSpielbestaetigungenParams = zod.object({
  saison_id: zod.string(),
});

/**
 * Move a fixture to the date and hour a club's open decline proposes, through the fixture's own save and refused as it is.
 *
 * The next confirmation pass closes every party's row about the slot left, tells each of the move and asks about the
 * new slot.
 * @summary Adopt a club's proposed date
 */
export const spielbestaetigungenAdoptSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenAdoptSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenAdoptSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

/**
 * Record the signed-in referee's first answer about a fixture they are booked on, until its kick-off: accept, or decline giving a reason.
 *
 * A decline takes them off the fixture, and the caller drops the cached fixture list after a successful answer, since
 * either answer can move the referee's name on the public fixture.
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
    answer: zod.enum(["agreed", "declined"]),
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
 * Record one club's answer about one Ansetzung, from whichever of its confirmed seats presses first, and the seat it came from.
 *
 * It writes no fixture: a decline's proposal is the administrator's to act on, and is refused wherever the
 * administrator's own save of that date would be.
 * @summary Confirm a fixture's Ansetzung as the team's seat holder, or decline it proposing another date
 */
export const spielbestaetigungenPostTeamAnswerPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenPostTeamAnswerParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenPostTeamAnswerPathSpielbestaetigungIdRegExp),
});

export const spielbestaetigungenPostTeamAnswerBodyReasonOneMax = 500;

export const spielbestaetigungenPostTeamAnswerBodyReasonOneRegExp = new RegExp("^[^\\x00\\v\\f\\u0085\\u2028\\u2029]*$");
export const spielbestaetigungenPostTeamAnswerBodyVorschlagOneDateRegExp = new RegExp("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$");
export const spielbestaetigungenPostTeamAnswerBodyVorschlagOneTimeRegExp = new RegExp("^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$");

export const SpielbestaetigungenPostTeamAnswerBody = zod
  .object({
    answer: zod.enum(["agreed", "declined"]),
    reason: zod.union([
      zod.string().min(1).max(spielbestaetigungenPostTeamAnswerBodyReasonOneMax).regex(spielbestaetigungenPostTeamAnswerBodyReasonOneRegExp),
      zod.null(),
    ]),
    vorschlag: zod.union([
      zod.object({
        date: zod.string().regex(spielbestaetigungenPostTeamAnswerBodyVorschlagOneDateRegExp),
        time: zod.string().regex(spielbestaetigungenPostTeamAnswerBodyVorschlagOneTimeRegExp),
      }),
      zod.null(),
    ]),
  })
  .describe("One club's answer about one Ansetzung, from whichever of its seats presses first.");

/**
 * Close a club's open decline proposing another date, which then stands as that club's one answer to this Ansetzung.
 *
 * The public fixture counts it as the club's agreement, and where its kick-off is still to come the club is told that
 * the date stands.
 * @summary Discard a club's proposed date
 */
export const spielbestaetigungenDiscardSpielbestaetigungPathSpielbestaetigungIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielbestaetigungenDiscardSpielbestaetigungParams = zod.object({
  spielbestaetigung_id: zod.string().regex(spielbestaetigungenDiscardSpielbestaetigungPathSpielbestaetigungIdRegExp),
});

/**
 * Record that the party of an open confirmation agreed to its Ansetzung elsewhere than signed in, the reason saying how.
 *
 * The answer is the league's record of how a date was agreed and is never rewritten; it names nobody, and its reason
 * goes at the season's end.
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
 * Every matchday and knockout round of one season, a planned one included, its matches in the admin shape, in play order.
 *
 * `current_spieltag_id` is the matchday to open on: the first holding a match still to be played, else the last.
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
 * A `dry_run` writes nothing and answers the same report, with the parties the confirmation pass would mail and the
 * later results the save would delete, which the save's `voided_results` must name back.
 * @summary Update a Spiel
 */
export const spielePatchSpielPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielePatchSpielParams = zod.object({
  spiel_id: zod.string().regex(spielePatchSpielPathSpielIdRegExp),
});

export const spielePatchSpielQueryAdoptsBerichtOneMin = 0;

export const spielePatchSpielQueryDryRunDefault = false;

export const SpielePatchSpielQueryParams = zod.object({
  adopts_bericht: zod
    .union([zod.int().min(spielePatchSpielQueryAdoptsBerichtOneMin), zod.null()])
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

export const spielePatchSpielBodySchiedsrichterOneSchiedsrichterIdOneRegExp = new RegExp("^[0-9a-fA-F]{24}$");
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
      .describe("A shoot-out as a save sends it: a key beside the two counts is refused, never dropped."),
    zod.null(),
  ]),
  note: zod.union([zod.string().max(spielePatchSpielBodyNoteOneMax), zod.null()]),
  schiedsrichter: zod.union([
    zod
      .object({
        payment: zod.int().min(spielePatchSpielBodySchiedsrichterOnePaymentMin),
        schiedsrichter_id: zod.union([zod.string().regex(spielePatchSpielBodySchiedsrichterOneSchiedsrichterIdOneRegExp), zod.null()]),
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
 * Beside it come the venues and referees to book, the clubs a knockout fixture may field, and the fixture's report,
 * confirmation rows and line-up counts.
 * @summary One Spiel and all the match editor offers and shows beside it
 */
export const spieleGetSpielAdminPathSpielIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieleGetSpielAdminParams = zod.object({
  spiel_id: zod.string().regex(spieleGetSpielAdminPathSpielIdRegExp),
});

/**
 * Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.
 *
 * Each moved choice is written with its evidence, and the caller drops its cached squad lists after a success, since
 * the scope decides whether a name is served.
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
 * The squad of one team in one season for a person holding a contact seat on it, ausgetragen rows included.
 *
 * Each surname is whole, and no address or telephone number of anybody is served.
 * @summary Read a team's squad as its seat holder
 */
export const spielerGetKaderPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerGetKaderParams = zod.object({
  team_id: zod.string().regex(spielerGetKaderPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Take a player out of this team's squad for the season, as any contact seat of the team may, the row staying.
 *
 * The person stays in the league, and only an administrator brings the row back.
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
 * The team and the Nachnominierung flag stay the stored row's, and a shared `nummer` is permitted.
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
export const spielerPatchKaderRowBodyVersionMin = 0;

export const SpielerPatchKaderRowBody = zod
  .object({
    nummer: zod.union([zod.string().regex(spielerPatchKaderRowBodyNummerOneRegExp), zod.null()]),
    position: zod.union([zod.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"]), zod.null()]),
    rolle: zod.union([zod.enum(["kapitaen", "co_kapitaen"]), zod.null()]),
    stufe: zod.union([zod.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"]), zod.null()]),
    version: zod.int().min(spielerPatchKaderRowBodyVersionMin),
  })
  .describe("A seat holder's edit of a squad row.");

/**
 * Every squad row of the season, live and ausgetragen alike, each named and with its club.
 *
 * `nummer_double` marks a live row whose number another live row of its own squad wears, compared as stored.
 * @summary One Saison's squad rows for its list
 */
export const SpielerGetSpielerAdminQueryParams = zod.object({
  saison_id: zod.string(),
});

/**
 * The signed-in pupil's squad row of one season, null where they hold none, and their club's fixtures in the draw's order.
 *
 * Each fixture's `starts` is true where the club's stored line-up starts them, false where it benches them, and null
 * where it does not name them or none is stored.
 * @summary A signed-in pupil's own season: their squad row and their team's fixtures
 */
export const SpielerGetSelfSaisonParams = zod.object({
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
 * Take a player out of a season's squad, the row staying, marked by `inactive_since`.
 *
 * The row records that this player wore this number in this squad, which stays true after they leave.
 * @summary Remove a Spieler from a squad
 */
export const spielerDeleteSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerDeleteSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerDeleteSaisonSpielerPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * What the Spieler editor shows: the person, their squad row of the season, and what its boxes may offer.
 *
 * `version` is what the one save sends, and `taken_rollen` each role another live row of the squad holds.
 * @summary What the Spieler editor shows, in one read
 */
export const spielerGetSpielerSaisonPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerGetSpielerSaisonParams = zod.object({
  spieler_id: zod.string().regex(spielerGetSpielerSaisonPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * Save the person's own facts and their squad row of the season together, the team staying the stored row's.
 *
 * A shared `nummer` is permitted.
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
    "The Spieler editor's one save: the person, and their squad row in the season the page stands under.\n\nReplaced wholesale, with no consent and no address, each being the person's own to change.",
  );

/**
 * Clear a squad row's `inactive_since`, the row returning with the number, position and role it had.
 * @summary Put a Spieler back in a squad they left
 */
export const spielerReactivateSaisonSpielerPathSpielerIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielerReactivateSaisonSpielerParams = zod.object({
  spieler_id: zod.string().regex(spielerReactivateSaisonSpielerPathSpielerIdRegExp),
  saison_id: zod.string(),
});

/**
 * Every venue in name order, the retired ones too where `include_inactive` asks for them.
 *
 * `maps_link` is a Maps search string, not a URL.
 * @summary List Spielorte
 */
export const spielorteGetSpielorteQueryIncludeInactiveDefault = false;

export const SpielorteGetSpielorteQueryParams = zod.object({
  include_inactive: zod.boolean().default(spielorteGetSpielorteQueryIncludeInactiveDefault),
});

/**
 * Create a venue, its `maps_link` derived from the name and the address.
 *
 * A name another venue holds, a retired one included, is refused.
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
 * Retire a venue, which stays readable for every match played there.
 *
 * Refused while an unplayed fixture is booked at it.
 * @summary Deactivate a Spielort (soft delete)
 */
export const spielorteDeleteSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteDeleteSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteDeleteSpielortPathSpielortIdRegExp),
});

/**
 * One venue, a retired one included, with the `version` its save sends back.
 * @summary One Spielort
 */
export const spielorteGetSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteGetSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteGetSpielortPathSpielortIdRegExp),
});

/**
 * Save a venue on the `version` it was read at, answering the version stored.
 *
 * Every fixture at the venue shows its new name and `maps_link`, and keeps the `mietpreis` agreed for it.
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
 * Return a retired venue to every default read.
 * @summary Bring a deactivated Spielort back
 */
export const spielorteReactivateSpielortPathSpielortIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpielorteReactivateSpielortParams = zod.object({
  spielort_id: zod.string().regex(spielorteReactivateSpielortPathSpielortIdRegExp),
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
 * Move a matchday's span, answering its `version` after the save.
 *
 * The span stays inside its season and around its own dated fixtures, and its `start` keeps the order its phase is
 * dated in.
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
 * One matchday by its id, a `future` season's included, with how many matchdays its phase holds.
 *
 * Beside it stands its season's `status`, so a `past` season's matchday, which no re-dating moves, can be shown as
 * final.
 * @summary One Spieltag for the admin editor
 */
export const spieltageGetSpieltagAdminPathSpieltagIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const SpieltageGetSpieltagAdminParams = zod.object({
  spieltag_id: zod.string().regex(spieltageGetSpieltagAdminPathSpieltagIdRegExp),
});

/**
 * One season's clubs, a `future` season's included, each with its seats and state, and what entering another offers.
 *
 * `state=retired` reads past the season's rows to every retired club, which is the way back to one, and `entry.closed`
 * is true where the season, not being `future`, takes no entry.
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
 * A club's `shorthand` is unique across every club, retired ones included, and a colour across the season's rows.
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
 * Retire a club from the league, its rows of the seasons it played left as they are.
 *
 * Refused while the club is entered in an `active` or `future` season.
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
 * Each choice moves only where it differs from the row as the page served it, so seats answered apart keep their
 * answers to a choice not changed.
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
 * What the team editor shows in one read: the club, its row of the season, and what each act of the page would meet.
 *
 * `version` is what the one save sends, each flag is judged as its write judges it, and `membership` and `link` are
 * null for a club holding no row of the season.
 * @summary One team in one season for the admin editor
 */
export const teamsGetTeamSaisonAdminPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamSaisonAdminParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamSaisonAdminPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Save the team editor's one version: the club, its name on its unfinished seasons' rows, and this season's group and colour.
 *
 * A `past` season keeps the club's fields open and fixes the row's group and colour, and a group move and a colour
 * are judged as an entry's.
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
    "The team editor's one save: the club, and its colour and group in the season the page stands under.\n\nReplaced wholesale, with no seat and no `austritt`: a seat is its own write's, and an exit is a write of its own,\nwhich owes mail.",
  );

/**
 * Record how a team left the season, once: an exit is never lifted and never replaced.
 *
 * An exit is taken from the season's start date on, before which the replacement takes a club out, and never on a
 * finished season.
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
    "The exit as an administrator writes it: the reason ceilinged as it arrives and stripped before its floor.\n\nOn the write side alone, so a read model takes a stored blank or a longer reason as it stands.",
  );

/**
 * Stamp this team's live registration link revoked, so it opens nothing from here on.
 *
 * The row stays, so a delivery event about a mail carrying the link still has somewhere to land.
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
 * The raw link is in this answer and in no other, the row storing only its hash, and it opens for as long as the season's
 * registration window does, judged afresh at each opening.
 * @summary Mint this team's registration link for a season
 */
export const teamsPostInvitationPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsPostInvitationParams = zod.object({
  team_id: zod.string().regex(teamsPostInvitationPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Owe this team's live registration link to every seat whose own person has confirmed it, one mail each, `mailed` counting them.
 *
 * Each mail mints a link of its own at its hand-out, so a copied link stays valid beside them, and a second press on
 * one day owes nothing again.
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
  .describe("The team's live link, to be mailed to its confirmed seats.");

/**
 * Write the person one seat holds on the row's `version`, a newly seated person owed a fresh link whose address `email` names.
 *
 * The same person, address and name folded, keeps the seat's record and link, and where the Trainer holds a second seat
 * a write on either seat writes both under one link.
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
 * Owe one contact seat a fresh confirmation link, and its pair where the Trainer holds both and has not confirmed it.
 *
 * The previous link opens nothing from this write on, the deadline restarts from today, and the answer names the
 * address the mail is owed to, never the link.
 * @summary Send one contact seat a fresh confirmation link
 */
export const teamsInviteKontaktPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsInviteKontaktParams = zod.object({
  team_id: zod.string().regex(teamsInviteKontaktPathTeamIdRegExp),
  saison_id: zod.string(),
  seat: zod.string(),
});

/**
 * Hand this season's row, and every fixture on it, to another club, keeping the schedule.
 *
 * The row's exit, colour, contacts and their links are cleared, and the outgoing club's live squad rows retired.
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
  .describe("Which club takes this season's row over. The path names the club going out.");

/**
 * Everything a team's Übersicht shows in one read, for a person holding any contact seat on the team in this season.
 *
 * No address, telephone number, birthdate or consent record of anybody is served.
 * @summary A team's Übersicht in one season
 */
export const teamsGetTeamOverviewPathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamOverviewParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamOverviewPathTeamIdRegExp),
  saison_id: zod.string(),
});

/**
 * Every fixture of the team in this season in the order the draw numbered them, for a person holding any contact seat on it.
 *
 * Each carries the state of the date the league asked the team to confirm and its line-up's marks, `termin` null where
 * no row asks the team about the fixture as it stands.
 * @summary A team's fixtures in one season, with what is open on each
 */
export const teamsGetTeamSpielePathTeamIdRegExp = new RegExp("^[0-9a-fA-F]{24}$");

export const TeamsGetTeamSpieleParams = zod.object({
  team_id: zod.string().regex(teamsGetTeamSpielePathTeamIdRegExp),
  saison_id: zod.string(),
});
