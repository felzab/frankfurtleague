import "server-only";

import {
  buildAddressChangeDiscardedEmail,
  buildAddressChangeEffectiveEmail,
  buildAddressChangeEmail,
  buildAddressChangeNoticeEmail,
} from "./adresswechselEmail";
import { buildCodeEmail } from "./authEmail";
import { buildBerechtigungEmail } from "./berechtigungEmail";
import {
  buildBewerbungAbsageEmail,
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungWiderspruchEmail,
  buildBewerbungZusageEmail,
} from "./bewerbungEmail";
import { buildEinladungEmail } from "./einladungEmail";
import { ContractBreakError } from "./errors";
import { buildKontaktBestaetigungEmail } from "./kontaktEmail";
import { buildLoeschungEmail } from "./loeschungEmail";
import { buildPasskeyGeloeschtEmail, buildPasskeyHinzugefuegtEmail } from "./passkeyEmail";
import { buildRegistrierungAbsageEmail, buildRegistrierungBestaetigungEmail, buildRegistrierungErinnerungEmail } from "./registrierungEmail";
import { buildSchiedsrichterBestaetigungEmail } from "./schiedsrichterEmail";
import { buildSperreEmail } from "./sperrlisteEmail";
import {
  buildSpielAnfrageEmail,
  buildSpielEinteilungAufgehobenEmail,
  buildSpielEinteilungEmail,
  buildSpielHinweisEmail,
  buildSpielVorschlagVerworfenEmail,
} from "./spielEmail";

import type { Mail } from "./emailShell";
import type { FLOutboxHandout } from "./generated/client/types";

/**
 * The tag every mail from the Postausgang carries, its value the row's id: the provider echoes a mail's tags on every
 * delivery event about it, so the event finds its row whether or not the send's report has landed.
 */
export const OUTBOX_TAG = "outbox_id";

/** One owed mail's facts: a member of the backend's discriminated union, its `art` naming the kind. */
type OutboxData = FLOutboxHandout["data"];

type OutboxKind = OutboxData["art"];

/** The member whose `art` admits `A`, read per member: one member may carry two kinds, as the passkey notices do. */
type Member<D, A> = D extends { art: infer K } ? (A extends K ? D : never) : never;

/** Each kind's own member, so a builder is handed its kind's typed facts and no other's. */
type DataPerKind = { [A in OutboxKind]: Member<OutboxData, A> };

/** What the hand-out answers beside the facts, and where the mail's links stand. */
interface Handout {
  /** The raw link token minted for this hand-out, or null where the mail carries no link. */
  readonly token: string | null;
  /** The row's secret, opened by the drain (`fl_frontend/src/core/mail.ts :: sendHandedOut`), or null where it holds none. */
  readonly secret: string | null;
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not production mails no production link. */
  readonly origin: string;
}

type MailBuilder<A extends OutboxKind> = (data: DataPerKind[A], handout: Handout) => Mail;

/** What a league mail carrying no link is built with beside its facts. */
export interface MailOrigin {
  readonly origin: string;
}

/** What a league mail carrying a link is built with: the hand-out's raw token, a bearer credential never taken apart. */
export interface MailLink extends MailOrigin {
  readonly token: string;
}

/** The hand-out's token for a kind that always carries a link: the backend mints one for every row naming where it lives. */
function minted({ token, origin }: Handout): MailLink {
  if (token === null) throw new ContractBreakError("A mail carrying a link was handed out without one.");

  return { token: token, origin: origin };
}

/**
 * Each kind's builder, which renders through the shell (`fl_frontend/src/core/emailShell.ts :: renderMail`). Total over
 * the backend's kinds: the annotation refuses a kind left out and, the value being an object literal, one the union
 * does not name.
 */
const MAIL_KINDS: { [A in OutboxKind]: MailBuilder<A> } = {
  sign_in_code: (_data, { secret, origin }) => buildCodeEmail(secretOf(secret), origin),
  passkey_hinzugefuegt: ({ instant, account }, { origin }) =>
    buildPasskeyHinzugefuegtEmail({ zeitpunkt: new Date(instant), origin: origin, konto: account }),
  passkey_erased: ({ instant, account }, { origin }) =>
    buildPasskeyGeloeschtEmail({ zeitpunkt: new Date(instant), origin: origin, konto: account }),
  account_erasure: (_data, { secret, origin }) => buildLoeschungEmail({ origin: origin, token: secretOf(secret) }),
  schiedsrichter_confirmation: (data, handout) => buildSchiedsrichterBestaetigungEmail(data, minted(handout)),
  spiel_request: (data, handout) => buildSpielAnfrageEmail(data, minted(handout)),
  spiel_reminder: (data, handout) => buildSpielAnfrageEmail(data, minted(handout)),
  spiel_einteilung: buildSpielEinteilungEmail,
  spiel_new_angesetzt: buildSpielHinweisEmail,
  spiel_abgesagt: buildSpielHinweisEmail,
  spiel_einteilung_lifted: buildSpielEinteilungAufgehobenEmail,
  spiel_vorschlag_discarded: buildSpielVorschlagVerworfenEmail,
  registrierung_confirmation: (data, handout) => buildRegistrierungBestaetigungEmail(data, minted(handout)),
  registrierung_reminder: (data, handout) => buildRegistrierungErinnerungEmail(data, minted(handout)),
  registrierung_absage: (data, handout) => buildRegistrierungAbsageEmail(data, handout),
  invitation: (data, handout) => buildEinladungEmail(data, minted(handout)),
  kontakt_confirmation: (data, handout) => buildKontaktBestaetigungEmail(data, minted(handout)),
  sperre: buildSperreEmail,
  grant: buildBerechtigungEmail,
  address_change_link: (data, handout) => buildAddressChangeEmail(data, minted(handout)),
  // The stop link, minted into the change's `stopp.token_hashes`.
  address_change_notice: (data, handout) => buildAddressChangeNoticeEmail(data, minted(handout)),
  address_change_effective: buildAddressChangeEffectiveEmail,
  address_change_discarded: buildAddressChangeDiscardedEmail,
  bewerbung_received: (data, handout) => buildBewerbungEingangEmail(data, minted(handout)),
  bewerbung_confirmation: (data, handout) => buildBewerbungBestaetigungEmail(data, minted(handout)),
  bewerbung_reminder: (data, handout) => buildBewerbungErinnerungEmail(data, minted(handout)),
  bewerbung_zusage: buildBewerbungZusageEmail,
  bewerbung_absage: buildBewerbungAbsageEmail,
  bewerbung_erasure: buildBewerbungGeloeschtEmail,
  bewerbung_widerspruch: buildBewerbungWiderspruchEmail,
};

/** A secret kind's secret, which its every row carries (`fl_frontend/src/core/auth/mails.ts :: oweSignInMail`). */
function secretOf(secret: string | null): string {
  if (secret === null) throw new Error("The mail's kind carries a secret, and its row holds none.");

  return secret;
}

/**
 * The mail one hand-out owes, or `undefined` where its kind has no builder: the generated client parses no answer, so a
 * backend deployed ahead of this build can hand out a kind this map does not hold. Indexed by the kind itself, so the
 * builder found takes exactly that kind's facts (TypeScript's correlated-union pattern, microsoft/TypeScript#47109).
 */
export function mailFor<A extends OutboxKind>(kind: A, data: DataPerKind[A], handout: Handout): Mail | undefined {
  return Object.hasOwn(MAIL_KINDS, kind) ? MAIL_KINDS[kind](data, handout) : undefined;
}
