import { formatAufzaehlung } from "./format";
import { FLTrikotFarbe } from "./generated/client/types";

import type { FLKontaktRolle } from "./generated/client/types";

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
 * `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS` is this table. Total over the generated
 * `FLTrikotFarbe`, so a colour the backend adds fails here; the list reads it in the client's order, which is the sheet's.
 */
const TRIKOT_FARBE = {
  schwarz: { label: "Schwarz", hex: "#111111" },
  weiss: { label: "Weiß", hex: "#f5f5f5" },
  grau: { label: "Grau", hex: "#8a9199" },
  braun: { label: "Braun", hex: "#7a4a28" },
  bordeaux: { label: "Bordeaux", hex: "#8e2430" },
  rot: { label: "Rot", hex: "#e52521" },
  koralle: { label: "Koralle", hex: "#ff5f37" },
  orange: { label: "Orange", hex: "#f47b20" },
  gold: { label: "Gold", hex: "#e9a928" },
  gelb: { label: "Gelb", hex: "#fff84f" },
  limette: { label: "Limette", hex: "#a8c83a" },
  hellgruen: { label: "Hellgrün", hex: "#75db06" },
  gruen: { label: "Grün", hex: "#0e7615" },
  smaragd: { label: "Smaragd", hex: "#008f68" },
  tuerkis: { label: "Türkis", hex: "#00a6a6" },
  cyan: { label: "Cyan", hex: "#1ba8c8" },
  hellblau: { label: "Hellblau", hex: "#74d3fc" },
  meerblau: { label: "Meerblau", hex: "#5a87d6" },
  blau: { label: "Blau", hex: "#2455c3" },
  dunkelblau: { label: "Dunkelblau", hex: "#142b63" },
  flieder: { label: "Flieder", hex: "#d49cf1" },
  violett: { label: "Violett", hex: "#7138b5" },
  magenta: { label: "Magenta", hex: "#c52a87" },
  rosa: { label: "Rosa", hex: "#e14b9a" },
} as const satisfies Record<FLTrikotFarbe, { readonly label: string; readonly hex: string }>;

export const TRIKOT_FARBEN: readonly { readonly value: FLTrikotFarbe; readonly label: string; readonly hex: string }[] = Object.values(
  FLTrikotFarbe,
).map((value) => ({ value: value, ...TRIKOT_FARBE[value] }));
