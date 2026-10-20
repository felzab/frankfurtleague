// Outside the view's "use client" module: the page reads the link on the server, where a client
// module's exports arrive only as references to render, and calling one throws.
import type { FLSpielerAdresswechselAnsichtResponse } from "@/features/spieler/schemas";

/**
 * Every state the new mailbox's link can be in but open, both lanes' pages alike: a change belongs to an
 * address. No `bestaetigt`, an answer removing what the link opens; „ungueltig“ is this side's, for a
 * token the read refused, which matched neither side.
 */
export type AdresswechselLinkZustand = "abgelaufen" | "ungueltig" | "gesperrt" | "nicht_bestaetigbar";

/** The states whose link the backend still takes the decline through, so the page keeps its token. */
type AdresswechselNurAblehnbar = Extract<AdresswechselLinkZustand, "abgelaufen" | "nicht_bestaetigbar">;

/** The stop link's states, which the notice to the address on file opens: every one offers the stop. */
export type AdresswechselStoppZustand = "freigabe_offen" | "offen" | "wartezeit";

/** What a link page is handed, never a name or an address: the page is open to whoever holds the link. */
export type AdresswechselAnsicht =
  | { zustand: "gueltig"; gueltigBis: string }
  | { zustand: AdresswechselStoppZustand; gueltigBis: string | null; wirksamAb: string | null }
  | { zustand: AdresswechselLinkZustand };

/** What the page opens on. The token rides only with a link a press can still spend. */
export type AdresswechselStart =
  | { zustand: "gueltig"; gueltigBis: string; token: string }
  | { zustand: AdresswechselStoppZustand; gueltigBis: string | null; wirksamAb: string | null; token: string }
  | { zustand: AdresswechselNurAblehnbar; token: string }
  | { zustand: Exclude<AdresswechselLinkZustand, AdresswechselNurAblehnbar> | "unlesbar" };

/** The read's answer as the page holds it, either lane's, the side being implied by the state. */
export function ansichtOf({ ansicht }: Pick<FLSpielerAdresswechselAnsichtResponse, "ansicht">): AdresswechselAnsicht {
  if (ansicht.seite === "bisherig") return { zustand: ansicht.zustand, gueltigBis: ansicht.gueltig_bis, wirksamAb: ansicht.wirksam_ab };

  return ansicht.zustand === "gueltig" ? { zustand: "gueltig", gueltigBis: ansicht.gueltig_bis } : { zustand: ansicht.zustand };
}

const NUR_ABLEHNBAR: readonly AdresswechselLinkZustand[] = ["abgelaufen", "nicht_bestaetigbar"] satisfies readonly AdresswechselNurAblehnbar[];

const istNurAblehnbar = (zustand: AdresswechselLinkZustand): zustand is AdresswechselNurAblehnbar => NUR_ABLEHNBAR.includes(zustand);

/** A dead link's state, the token kept where the backend still takes the decline through it. */
export function totStand(zustand: AdresswechselLinkZustand, token: string): AdresswechselStart {
  return istNurAblehnbar(zustand) ? { zustand: zustand, token: token } : { zustand: zustand };
}

/** What the page opens on for what the read answered: an open link and a stop link keep their token. */
export function startOf(gelesen: AdresswechselAnsicht, token: string): AdresswechselStart {
  return "gueltigBis" in gelesen ? { ...gelesen, token: token } : totStand(gelesen.zustand, token);
}
