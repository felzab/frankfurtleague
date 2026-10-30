import { formatAufzaehlung } from "./format";

import type { FLKontaktRolle, FLTrikotFarbe } from "./generated/client/types";

/**
 * Each seat's name in a sentence to the public, in the seats' order. Here, in `core`, because the mail builders name a
 * reader's seats and may reach no feature; `fl_frontend/src/features/teams/constants.ts :: KONTAKT_ROLLEN` builds its
 * long form from this table.
 */
export const KONTAKT_ROLLE_LANGFORM = {
  ansprechperson: "Ansprechperson",
  stellvertretung: "Stellvertretung",
  trainer: "Trainerin oder Trainer",
} as const satisfies Record<FLKontaktRolle, string>;

/**
 * The seats one reader holds, as the phrase a mail addresses them by. In the table's order rather than the argument's: a
 * person holding two seats reads one phrase whichever record the seats were collected from.
 */
export function rollenText(rollen: readonly FLKontaktRolle[]): string {
  const reihenfolge = Object.keys(KONTAKT_ROLLE_LANGFORM) as FLKontaktRolle[];

  return formatAufzaehlung(reihenfolge.filter((rolle) => rollen.includes(rolle)).map((rolle) => KONTAKT_ROLLE_LANGFORM[rolle]));
}

/**
 * The league's kit palette in its colour sheet's order, neutrals first, then round the colour wheel. The hex is copied
 * from the league's colour sheet and authoritative over any eyeballed match: a changed one recolours every row stored
 * under its slug, and contradicts every acceptance mail already sent, which states the hex to the school.
 * `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS` is this table.
 */
export const TRIKOT_FARBEN: readonly { readonly value: FLTrikotFarbe; readonly label: string; readonly hex: string }[] = [
  { value: "schwarz", label: "Schwarz", hex: "#111111" },
  { value: "weiss", label: "Weiß", hex: "#f5f5f5" },
  { value: "grau", label: "Grau", hex: "#8a9199" },
  { value: "braun", label: "Braun", hex: "#7a4a28" },
  { value: "bordeaux", label: "Bordeaux", hex: "#8e2430" },
  { value: "rot", label: "Rot", hex: "#e52521" },
  { value: "koralle", label: "Koralle", hex: "#ff5f37" },
  { value: "orange", label: "Orange", hex: "#f47b20" },
  { value: "gold", label: "Gold", hex: "#e9a928" },
  { value: "gelb", label: "Gelb", hex: "#fff84f" },
  { value: "limette", label: "Limette", hex: "#a8c83a" },
  { value: "hellgruen", label: "Hellgrün", hex: "#75db06" },
  { value: "gruen", label: "Grün", hex: "#0e7615" },
  { value: "smaragd", label: "Smaragd", hex: "#008f68" },
  { value: "tuerkis", label: "Türkis", hex: "#00a6a6" },
  { value: "cyan", label: "Cyan", hex: "#1ba8c8" },
  { value: "hellblau", label: "Hellblau", hex: "#74d3fc" },
  { value: "meerblau", label: "Meerblau", hex: "#5a87d6" },
  { value: "blau", label: "Blau", hex: "#2455c3" },
  { value: "dunkelblau", label: "Dunkelblau", hex: "#142b63" },
  { value: "flieder", label: "Flieder", hex: "#d49cf1" },
  { value: "violett", label: "Violett", hex: "#7138b5" },
  { value: "magenta", label: "Magenta", hex: "#c52a87" },
  { value: "rosa", label: "Rosa", hex: "#e14b9a" },
];
