import "server-only";

import { buildCodeEmail } from "./authEmail";
import { buildLoeschungEmail } from "./loeschungEmail";
import { buildPasskeyGeloeschtEmail, buildPasskeyHinzugefuegtEmail } from "./passkeyEmail";

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
  /** The row's secret, opened by the drain (`fl_frontend/src/core/mail.ts :: zustellen`), or null where it holds none. */
  readonly geheim: string | null;
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not production mails no production link. */
  readonly origin: string;
}

type MailBuilder<A extends PostausgangArt> = (daten: DatenJeArt[A], ausgabe: Ausgabe) => Mail;

/** Each kind's builder, which renders through the shell (`fl_frontend/src/core/emailShell.ts :: renderMail`). */
const MAIL_KINDS: { [A in PostausgangArt]?: MailBuilder<A> } = {
  anmeldecode: (_daten, { geheim, origin }) => buildCodeEmail(geheimDerArt(geheim), origin),
  passkey_hinzugefuegt: ({ zeitpunkt, konto }, { origin }) =>
    buildPasskeyHinzugefuegtEmail({ zeitpunkt: new Date(zeitpunkt), origin: origin, konto: konto }),
  passkey_geloescht: ({ zeitpunkt, konto }, { origin }) =>
    buildPasskeyGeloeschtEmail({ zeitpunkt: new Date(zeitpunkt), origin: origin, konto: konto }),
  konto_loeschung: (_daten, { geheim, origin }) => buildLoeschungEmail({ origin: origin, token: geheimDerArt(geheim) }),
};

/** A secret kind's secret, which its every row carries (`fl_frontend/src/core/auth.ts :: oweSignInMail`). */
function geheimDerArt(geheim: string | null): string {
  if (geheim === null) throw new Error("The mail's kind carries a secret, and its row holds none.");

  return geheim;
}

/**
 * The mail one hand-out owes, or `undefined` where its kind has no builder. Indexed by the kind itself, so the builder
 * found takes exactly that kind's facts (TypeScript's correlated-union pattern, microsoft/TypeScript#47109).
 */
export function mailFor<A extends PostausgangArt>(art: A, daten: DatenJeArt[A], ausgabe: Ausgabe): Mail | undefined {
  return MAIL_KINDS[art]?.(daten, ausgabe);
}
