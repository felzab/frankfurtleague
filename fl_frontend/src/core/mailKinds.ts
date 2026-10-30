import "server-only";

import { buildEinladungEmail } from "./einladungEmail";
import { ContractBreakError } from "./errors";
import { buildRegistrierungAbsageEmail, buildRegistrierungBestaetigungEmail, buildRegistrierungErinnerungEmail } from "./registrierungEmail";
import { buildSchiedsrichterBestaetigungEmail } from "./schiedsrichterEmail";

import type { Mail } from "./emailShell";
import type { FLPostausgangAusgabe } from "./generated/client/types";

/**
 * The tag every mail from the Postausgang carries, its value the row's id: the provider echoes a mail's tags on every
 * delivery event about it, so the event finds its row whether or not the send's report has landed.
 */
export const POSTAUSGANG_TAG = "postausgang_id";

/** One owed mail's facts: a member of the backend's discriminated union, its `art` naming the kind. */
type PostausgangDaten = FLPostausgangAusgabe["daten"];

type PostausgangArt = PostausgangDaten["art"];

/** The member whose `art` admits `A`, read per member: one member may carry two kinds, as the passkey notices do. */
type Mitglied<D, A> = D extends { art: infer K } ? (A extends K ? D : never) : never;

/** Each kind's own member, so a builder is handed its kind's typed facts and no other's. */
type DatenJeArt = { [A in PostausgangArt]: Mitglied<PostausgangDaten, A> };

/** What the hand-out answers beside the facts, and where the mail's links stand. */
interface Ausgabe {
  /** The raw link token minted for this hand-out, or null where the mail carries no link. */
  readonly token: string | null;
  /** The row's secret, encrypted by the frontend before it was owed, or null. */
  readonly geheim: string | null;
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not production mails no production link. */
  readonly origin: string;
}

type MailBuilder<A extends PostausgangArt> = (daten: DatenJeArt[A], ausgabe: Ausgabe) => Mail;

/** What a league mail carrying no link is built with beside its facts. */
export interface MailOrt {
  readonly origin: string;
}

/** What a league mail carrying a link is built with: the hand-out's raw token, a bearer credential never taken apart. */
export interface MailLink extends MailOrt {
  readonly token: string;
}

/** The hand-out's token for a kind that always carries a link: the backend mints one for every row naming where it lives. */
function gemintet({ token, origin }: Ausgabe): MailLink {
  if (token === null) throw new ContractBreakError("A mail carrying a link was handed out without one.");

  return { token: token, origin: origin };
}

/** Each kind's builder, which renders through the shell (`fl_frontend/src/core/emailShell.ts :: renderMail`). */
const MAIL_KINDS: { [A in PostausgangArt]?: MailBuilder<A> } = {
  schiedsrichter_bestaetigung: buildSchiedsrichterBestaetigungEmail,
  registrierung_bestaetigung: (daten, ausgabe) => buildRegistrierungBestaetigungEmail(daten, gemintet(ausgabe)),
  registrierung_erinnerung: (daten, ausgabe) => buildRegistrierungErinnerungEmail(daten, gemintet(ausgabe)),
  registrierung_absage: (daten, ausgabe) => buildRegistrierungAbsageEmail(daten, ausgabe),
  einladung: (daten, ausgabe) => buildEinladungEmail(daten, gemintet(ausgabe)),
};

/**
 * The mail one hand-out owes, or `undefined` where its kind has no builder. Indexed by the kind itself, so the builder
 * found takes exactly that kind's facts (TypeScript's correlated-union pattern, microsoft/TypeScript#47109).
 */
export function mailFor<A extends PostausgangArt>(art: A, daten: DatenJeArt[A], ausgabe: Ausgabe): Mail | undefined {
  return MAIL_KINDS[art]?.(daten, ausgabe);
}
