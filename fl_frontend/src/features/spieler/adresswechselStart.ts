// Outside the view's "use client" module: the page reads the link on the server, where a client
// module's exports arrive only as references to render, and calling one throws.
import type { SpielerAdresswechselAnsicht, SpielerAdresswechselNurAblehnbar, SpielerAdresswechselZustand } from "@/features/spieler/types";

/** What the page opens on. The token rides only with a link a press can still spend. */
export type SpielerAdresswechselStart =
  | { zustand: "gueltig"; frist: string; token: string }
  | { zustand: SpielerAdresswechselNurAblehnbar; token: string }
  | { zustand: Exclude<SpielerAdresswechselZustand, SpielerAdresswechselNurAblehnbar> | "unlesbar" };

const NUR_ABLEHNBAR: readonly SpielerAdresswechselZustand[] = [
  "abgelaufen",
  "nicht_bestaetigbar",
] satisfies readonly SpielerAdresswechselNurAblehnbar[];

const istNurAblehnbar = (zustand: SpielerAdresswechselZustand): zustand is SpielerAdresswechselNurAblehnbar => NUR_ABLEHNBAR.includes(zustand);

/** A dead link's state, the token kept where the backend still takes the decline through it. */
export function totStand(zustand: SpielerAdresswechselZustand, token: string): SpielerAdresswechselStart {
  return istNurAblehnbar(zustand) ? { zustand: zustand, token: token } : { zustand: zustand };
}

/** What the page opens on for what the read answered. */
export function startOf(gelesen: SpielerAdresswechselAnsicht, token: string): SpielerAdresswechselStart {
  return gelesen.zustand === "gueltig" ? { ...gelesen, token: token } : totStand(gelesen.zustand, token);
}
