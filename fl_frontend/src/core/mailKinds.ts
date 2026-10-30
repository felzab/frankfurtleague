import "server-only";

import {
  buildAdresswechselEmail,
  buildAdresswechselHinweisEmail,
  buildAdresswechselNichtWirksamEmail,
  buildAdresswechselWirksamEmail,
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

/**
 * Each kind's builder, which renders through the shell (`fl_frontend/src/core/emailShell.ts :: renderMail`). Total over
 * the backend's kinds: the annotation refuses a kind left out and, the value being an object literal, one the union
 * does not name.
 */
const MAIL_KINDS: { [A in PostausgangArt]: MailBuilder<A> } = {
  anmeldecode: (_daten, { geheim, origin }) => buildCodeEmail(geheimDerArt(geheim), origin),
  passkey_hinzugefuegt: ({ zeitpunkt, konto }, { origin }) =>
    buildPasskeyHinzugefuegtEmail({ zeitpunkt: new Date(zeitpunkt), origin: origin, konto: konto }),
  passkey_geloescht: ({ zeitpunkt, konto }, { origin }) =>
    buildPasskeyGeloeschtEmail({ zeitpunkt: new Date(zeitpunkt), origin: origin, konto: konto }),
  konto_loeschung: (_daten, { geheim, origin }) => buildLoeschungEmail({ origin: origin, token: geheimDerArt(geheim) }),
  schiedsrichter_bestaetigung: (daten, ausgabe) => buildSchiedsrichterBestaetigungEmail(daten, gemintet(ausgabe)),
  spiel_anfrage: (daten, ausgabe) => buildSpielAnfrageEmail(daten, gemintet(ausgabe)),
  spiel_erinnerung: (daten, ausgabe) => buildSpielAnfrageEmail(daten, gemintet(ausgabe)),
  spiel_einteilung: buildSpielEinteilungEmail,
  spiel_neu_angesetzt: buildSpielHinweisEmail,
  spiel_abgesagt: buildSpielHinweisEmail,
  spiel_einteilung_aufgehoben: buildSpielEinteilungAufgehobenEmail,
  spiel_vorschlag_verworfen: buildSpielVorschlagVerworfenEmail,
  registrierung_bestaetigung: (daten, ausgabe) => buildRegistrierungBestaetigungEmail(daten, gemintet(ausgabe)),
  registrierung_erinnerung: (daten, ausgabe) => buildRegistrierungErinnerungEmail(daten, gemintet(ausgabe)),
  registrierung_absage: (daten, ausgabe) => buildRegistrierungAbsageEmail(daten, ausgabe),
  einladung: (daten, ausgabe) => buildEinladungEmail(daten, gemintet(ausgabe)),
  kontakt_bestaetigung: (daten, ausgabe) => buildKontaktBestaetigungEmail(daten, gemintet(ausgabe)),
  sperre: buildSperreEmail,
  berechtigung: buildBerechtigungEmail,
  adresswechsel_link: (daten, ausgabe) => buildAdresswechselEmail(daten, gemintet(ausgabe)),
  // The stop link, minted into the change's `stopp.token_hashes`.
  adresswechsel_hinweis: (daten, ausgabe) => buildAdresswechselHinweisEmail(daten, gemintet(ausgabe)),
  adresswechsel_wirksam: buildAdresswechselWirksamEmail,
  adresswechsel_verworfen: buildAdresswechselNichtWirksamEmail,
  bewerbung_eingang: (daten, ausgabe) => buildBewerbungEingangEmail(daten, gemintet(ausgabe)),
  bewerbung_bestaetigung: (daten, ausgabe) => buildBewerbungBestaetigungEmail(daten, gemintet(ausgabe)),
  bewerbung_erinnerung: (daten, ausgabe) => buildBewerbungErinnerungEmail(daten, gemintet(ausgabe)),
  bewerbung_zusage: buildBewerbungZusageEmail,
  bewerbung_absage: buildBewerbungAbsageEmail,
  bewerbung_loeschung: buildBewerbungGeloeschtEmail,
  bewerbung_widerspruch: buildBewerbungWiderspruchEmail,
};

/** A secret kind's secret, which its every row carries (`fl_frontend/src/core/auth.ts :: oweSignInMail`). */
function geheimDerArt(geheim: string | null): string {
  if (geheim === null) throw new Error("The mail's kind carries a secret, and its row holds none.");

  return geheim;
}

/**
 * The mail one hand-out owes, or `undefined` where its kind has no builder: the generated client parses no answer, so a
 * backend deployed ahead of this build can hand out a kind this map does not hold. Indexed by the kind itself, so the
 * builder found takes exactly that kind's facts (TypeScript's correlated-union pattern, microsoft/TypeScript#47109).
 */
export function mailFor<A extends PostausgangArt>(art: A, daten: DatenJeArt[A], ausgabe: Ausgabe): Mail | undefined {
  return Object.hasOwn(MAIL_KINDS, art) ? MAIL_KINDS[art](daten, ausgabe) : undefined;
}
