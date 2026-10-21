// Outside the view's "use client" module: the page reads the link on the server, where a client
// module's exports arrive only as references to render, and calling one throws.
import type { FLAdresswechselAnsichtResponse, FLAdresswechselBisherigZustand, FLAdresswechselEndeArt, FLAdresswechselWeg } from "./schemas";

/** The new mailbox's states besides an open link, and a token the read matched to nothing. */
export type AdresswechselLinkZustand = "abgelaufen" | "ungueltig" | "gesperrt" | "nicht_bestaetigbar";

/** The new mailbox's states the backend still takes the decline through, so the page keeps their token. */
type NurAblehnbar = Extract<AdresswechselLinkZustand, "abgelaufen" | "nicht_bestaetigbar">;

/**
 * What the link page is handed, never a name or an address: the page is open to whoever holds the link.
 * A pressed link and an ended change keep answering, so the page says how the change stands or ended.
 */
export type AdresswechselAnsicht =
  | { zustand: "gueltig"; gueltigBis: string; weg: FLAdresswechselWeg }
  | { zustand: "bestaetigt"; wirksamAb: string | null; genehmigungOffen: boolean; weg: FLAdresswechselWeg }
  | { zustand: FLAdresswechselBisherigZustand; gueltigBis: string | null; wirksamAb: string | null; weg: FLAdresswechselWeg }
  | { zustand: NurAblehnbar; weg: FLAdresswechselWeg }
  | { zustand: "beendet"; seite: "neu" | "bisherig"; art: FLAdresswechselEndeArt }
  | { zustand: Exclude<AdresswechselLinkZustand, NurAblehnbar> };

type OhnePresse = { zustand: "beendet" | "bestaetigt" | "gesperrt" | "ungueltig" };

/** What the page opens on. The token rides only with a link a press can still spend. */
export type AdresswechselStart =
  (Exclude<AdresswechselAnsicht, OhnePresse> & { token: string }) | Extract<AdresswechselAnsicht, OhnePresse> | { zustand: "unlesbar" };

/** The read's answer as the page holds it: the side is implied by the state. */
export function ansichtOf({ ansicht }: Pick<FLAdresswechselAnsichtResponse, "ansicht">): AdresswechselAnsicht {
  if (ansicht.zustand === "beendet") return { zustand: "beendet", seite: ansicht.seite, art: ansicht.art };
  if (ansicht.seite === "bisherig") {
    return { zustand: ansicht.zustand, gueltigBis: ansicht.gueltig_bis, wirksamAb: ansicht.wirksam_ab, weg: ansicht.weg };
  }

  switch (ansicht.zustand) {
    // Null only on `bestaetigt`, by the read's contract; read as the dead link rather than a deadline of nothing.
    case "gueltig":
      return ansicht.gueltig_bis === null
        ? { zustand: "ungueltig" }
        : { zustand: "gueltig", gueltigBis: ansicht.gueltig_bis, weg: ansicht.weg };
    case "bestaetigt":
      // Null only outside `bestaetigt`, by the read's contract.
      return { zustand: "bestaetigt", wirksamAb: ansicht.wirksam_ab, genehmigungOffen: ansicht.genehmigung_offen === true, weg: ansicht.weg };
    case "gesperrt":
      return { zustand: "gesperrt" };
    default:
      return { zustand: ansicht.zustand, weg: ansicht.weg };
  }
}

/** What the page opens on for what the read answered: every state a press can still spend keeps its token. */
export function startOf(gelesen: AdresswechselAnsicht, token: string): AdresswechselStart {
  switch (gelesen.zustand) {
    // A pressed link answers a second press with the change's end, so it holds no press either.
    case "beendet":
    case "bestaetigt":
    case "gesperrt":
    case "ungueltig":
      return gelesen;
    default:
      return { ...gelesen, token: token };
  }
}

/** A press that landed: the confirmation's outcome, `wirksam` where it took effect in this press. */
export type AdresswechselGedrueckt = {
  success: true;
  antwort: "bestaetigt" | "abgelehnt" | "gestoppt";
  wirksam: boolean;
  wirksam_ab: string | null;
  genehmigung_offen: boolean;
};
