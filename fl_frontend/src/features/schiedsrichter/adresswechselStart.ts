// Outside the view's "use client" module: the page reads the link on the server, where a client
// module's exports arrive only as references to render, and calling one throws.
import type { AdresswechselAnsicht, AdresswechselLinkZustand, AdresswechselNurAblehnbar } from "@/features/schiedsrichter/types";

/** What the page opens on. The token rides only with a link a press can still spend, for the consent page's reason. */
export type SchiedsrichterAdresswechselStart =
  | { zustand: "gueltig"; vorname: string; frist: string; token: string }
  | { zustand: AdresswechselNurAblehnbar; token: string }
  | { zustand: Exclude<AdresswechselLinkZustand, AdresswechselNurAblehnbar> | "unlesbar" };

const NUR_ABLEHNBAR: readonly AdresswechselLinkZustand[] = ["abgelaufen", "nicht_bestaetigbar"] satisfies readonly AdresswechselNurAblehnbar[];

const istNurAblehnbar = (zustand: AdresswechselLinkZustand): zustand is AdresswechselNurAblehnbar => NUR_ABLEHNBAR.includes(zustand);

/** A dead link's state, the token kept where the backend still takes the decline through it. */
export function totStand(zustand: AdresswechselLinkZustand, token: string): SchiedsrichterAdresswechselStart {
  return istNurAblehnbar(zustand) ? { zustand: zustand, token: token } : { zustand: zustand };
}

/** What the page opens on for what the read answered. */
export function startOf(gelesen: AdresswechselAnsicht, token: string): SchiedsrichterAdresswechselStart {
  return gelesen.zustand === "gueltig" ? { ...gelesen, token: token } : totStand(gelesen.zustand, token);
}
