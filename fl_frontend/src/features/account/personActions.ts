"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { action, PAGE_HOLDER, ticked } from "@/core/action";
import { deleteOwnAccount, DeletionOutcomeUnknown, requestAccountDeletion } from "@/core/auth/accounts";
import { endOtherSessions } from "@/core/auth/accountSessions";
import { COPY } from "@/core/copy/shared";
import {
  accountDeleteAddressChange,
  accountPostAddressChange,
  bewerbungenPatchEinwilligung,
  registrierungenPatchEinwilligung,
  schiedsrichterPatchEinwilligung,
  spielerPatchEinwilligung,
  teamsPatchEinwilligung,
} from "@/core/generated/client/sdk";
import {
  BewerbungenPatchEinwilligungBody,
  BewerbungenPatchEinwilligungParams,
  RegistrierungenPatchEinwilligungBody,
  RegistrierungenPatchEinwilligungParams,
  SchiedsrichterPatchEinwilligungBody,
  SchiedsrichterPatchEinwilligungParams,
  SpielerPatchEinwilligungBody,
  TeamsPatchEinwilligungBody,
  TeamsPatchEinwilligungParams,
} from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInAddressSchema } from "@/features/auth/schemas";
import { linkInvalid } from "@/kit/mailedLinkState";
import { TO_ACCOUNT } from "@/kit/MailedPage";

import type { LaneAnswer } from "@/core/action";
import type { FLKontaktKenntnisnahmeScope } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

/** An act that posts no field but its page's holder: the signed-in session names everything it acts on. */
const HOLDER_ALONE = z.object(PAGE_HOLDER);

/**
 * The league's records go first, then the account. The deletion ends the caller's own session, so a done one leads to a
 * page needing none rather than answering: Next renders the posting page again after an action writes a cookie, and
 * the library deletes the session's cookie, but a `redirect` from the body renders the destination alone, the builder
 * having cleared the site's tag on its way out. A link the library refuses, spent, lapsed or another account's, ends as
 * the link no longer valid, with nothing erased; so does one the library spent on a press the backend's erasure then
 * refused, which leads to Konto, where a fresh link is asked for. A press failing past the spent link with its outcome
 * unknown is a fault inside the system, the shared failure line, and a press again is safe, the link being spent.
 */
export const eraseAccount = action({
  lane: "person",
  claim: "account",
  passkey: true,
  name: "eraseAccount",
  // The library's own token, which no backend schema publishes: one line of letters, digits, `-` and `_`.
  input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), ...PAGE_HOLDER }),
  run: async ({ token }, { subject }): Promise<LaneAnswer<EndState>> => {
    // Refused before the library spends the link, so the same link completes after a handover.
    if (subject.records.admin_tier === "owner") {
      return { ok: false, reason: SERVER_COPY.refusalLine.owner_erasure };
    }

    let outcome: Awaited<ReturnType<typeof deleteOwnAccount>>;
    try {
      outcome = await deleteOwnAccount(token, await headers());
    } catch (failed) {
      if (!(failed instanceof DeletionOutcomeUnknown)) throw failed;
      logger.error("account.deletion_outcome_unknown", undefined, { name: failed.cause instanceof Error ? failed.cause.name : "unknown" });
      return { ok: false, reason: COPY.shared.failure.unexpected };
    }
    if (outcome !== "deleted") {
      return { ok: true, value: linkInvalid(TO_ACCOUNT) };
    }

    await forgetMailedLink(ROUTES.accountErasure.path());
    redirect(ROUTES.accountErased.path());
  },
});

/**
 * The final press asks an administrator's touch, the one check guarding it, since the backend judges no fresh sign-in.
 * The address typed is one the person will sign in at, so it is held to that schema before it is mailed. An account
 * standing at the new address is not refused here: the start answers alike whatever the new address holds, so it tells
 * nobody which addresses hold an account, and the new mailbox's own press refuses it. An administrator's press sends
 * its dry run first, so a refusal stands on the box before the touch; a person's press sends the start alone.
 */
export const startAddressChange = action({
  lane: "person",
  claim: "account",
  passkey: true,
  dryRun: true,
  name: "startAddressChange",
  input: z.object({ email: SignInAddressSchema, ...PAGE_HOLDER }),
  boxes: ["email"],
  examples: { email: COPY.shared.field.exampleAddress },
  run: async ({ email }, { dryRun }) => {
    await accountPostAddressChange({ email }, { dry_run: dryRun });
    return { ok: true, value: undefined };
  },
});

/** The withdrawal hands nothing over, so it asks no touch. */
export const withdrawAddressChange = action({
  lane: "person",
  claim: "account",
  name: "withdrawAddressChange",
  input: HOLDER_ALONE,
  run: async () => {
    await accountDeleteAddressChange();
    return { ok: true, value: undefined };
  },
});

/**
 * Mails the person the link deleting their account, to the session's own address and never a posted one; the deletion
 * waits on that link's page. The library answers a send that failed as one that went, so the answer is the same
 * either way.
 */
export const requestErasure = action({
  lane: "person",
  claim: "account",
  name: "requestErasure",
  input: HOLDER_ALONE,
  run: async () => {
    await requestAccountDeletion(await headers());
    return { ok: true, value: undefined };
  },
});

export const signOutOthers = action({
  lane: "person",
  claim: "account",
  name: "signOutOthers",
  input: HOLDER_ALONE,
  run: async (_, { served }) => {
    await endOtherSessions(served.user.id, served.session.id);
    // The sign-in store holds what changed, past every cached read: the device count is read again.
    refresh();
    return { ok: true, value: undefined };
  },
});

// The consents Deine Einträge saves, one record a box: both choices on every press, with the labels the page showed
// and the evidence it was served, so a press on a page older than either change is refused rather than stamped. Each is
// an act of the account, which only Konto's page reaches, so an administrator's mailbox changes none of them.

/**
 * A box's fields as its kind's write spells them: the evidence and the labels the page carries under dotted names, an
 * evidence the record holds none of posting nothing.
 */
function consentOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const posted = raw as Readonly<Record<string, unknown>>;
  return {
    ...posted,
    evidence_state: { scope: posted["evidence_state.scope"] ?? null, media: posted["evidence_state.media"] ?? null },
    text_versions: { scope: posted["text_versions.scope"], media: posted["text_versions.media"] },
  };
}

/** What every box posts beside its write's fields: the media box, ticked or not, and the address its page was drawn for. */
const BOX = { media: ticked, ...PAGE_HOLDER };

/** A contact's scope, its WhatsApp box ticked or not; a name's is the option its choice posts, as the write's own enum takes it. */
const whatsapp = ticked.transform((given): FLKontaktKenntnisnahmeScope => (given ? "kontakt_data_whatsapp" : "kontakt_data"));

/** One box's press, by the kind of record it saves, with the ids naming the record. */
const Consent = z.preprocess(
  consentOf,
  z.discriminatedUnion("kind", [
    SpielerPatchEinwilligungBody.extend({ kind: z.literal("spieler"), ...BOX }),
    RegistrierungenPatchEinwilligungParams.extend({ ...RegistrierungenPatchEinwilligungBody.shape, kind: z.literal("registrierung"), ...BOX }),
    SchiedsrichterPatchEinwilligungParams.extend({ ...SchiedsrichterPatchEinwilligungBody.shape, kind: z.literal("schiedsrichter"), ...BOX }),
    TeamsPatchEinwilligungParams.extend({ ...TeamsPatchEinwilligungBody.shape, kind: z.literal("seat"), scope: whatsapp, ...BOX }),
    BewerbungenPatchEinwilligungParams.extend({
      ...BewerbungenPatchEinwilligungBody.shape,
      kind: z.literal("bewerbung"),
      scope: whatsapp,
      ...BOX,
    }),
  ]),
);

/** The write's own body out of a press, which also names its kind, its record and its page's address. */
const choicesOf = <Press extends { scope: unknown; media: boolean; evidence_state: unknown; text_versions: unknown }>({
  scope,
  media,
  evidence_state,
  text_versions,
}: Press): Pick<Press, "scope" | "media" | "evidence_state" | "text_versions"> => ({ scope, media, evidence_state, text_versions });

/**
 * One box's save, by its kind's write. The kind, the ids, the evidence and the labels are carried by the page unseen
 * and trusted no further than the write checks them again: the backend judges the record the session's own and the
 * evidence current, and a label other than its choice's current one answers as a stale page before anything is sent.
 * A media choice refused as given below its floor is a stale page too, as the builder answers every code the catalogue
 * does not word: the page offers the switch from the served age alone, so only a birthdate or a day that moved since
 * it was served reaches it, and the page read again shows the switch closed under its own phrase.
 */
export const saveConsent = action({
  lane: "person",
  claim: "account",
  name: "saveConsent",
  input: Consent,
  run: async (press) => {
    switch (press.kind) {
      case "spieler":
        await spielerPatchEinwilligung(choicesOf(press));
        break;
      // One address may hold several referee rows.
      case "schiedsrichter":
        await schiedsrichterPatchEinwilligung(press.schiedsrichter_id, choicesOf(press));
        break;
      // A seat holder's own two choices for every seat they hold on one team's season, a past season's to withdraw.
      case "seat":
        await teamsPatchEinwilligung(press.team_id, press.saison_id, choicesOf(press));
        break;
      // A pupil's withdrawal on their pending registration, whose grant waits on the team's admission.
      case "registrierung":
        await registrierungenPatchEinwilligung(press.registrierung_id, choicesOf(press));
        break;
      // A seat holder's withdrawal on a pending application, whose grant is its confirmation page's alone.
      case "bewerbung":
        await bewerbungenPatchEinwilligung(press.bewerbung_id, choicesOf(press));
        break;
    }
    return { ok: true, value: undefined };
  },
});
