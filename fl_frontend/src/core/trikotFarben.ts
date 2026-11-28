import { COPY } from "./copy/shared";
import { FLTrikotFarbe } from "./generated/client/types";

import type { Option } from "@/kit/OptionList";

/**
 * The league's kit palette in its colour sheet's order, neutrals first, then round the colour wheel. The hex is copied
 * from the league's colour sheet and authoritative over any eyeballed match: a changed one recolours every row stored
 * under its slug, and contradicts every acceptance mail already sent, which states the hex to the school.
 * Total over the generated `FLTrikotFarbe`, so a colour the backend adds fails here; the list reads it in the client's
 * order, which is the sheet's.
 */
const TRIKOT_HEX = {
  schwarz: "#111111",
  weiss: "#f5f5f5",
  grau: "#8a9199",
  braun: "#7a4a28",
  bordeaux: "#8e2430",
  rot: "#e52521",
  koralle: "#ff5f37",
  orange: "#f47b20",
  gold: "#e9a928",
  gelb: "#fff84f",
  limette: "#a8c83a",
  hellgruen: "#75db06",
  gruen: "#0e7615",
  smaragd: "#008f68",
  tuerkis: "#00a6a6",
  cyan: "#1ba8c8",
  hellblau: "#74d3fc",
  meerblau: "#5a87d6",
  blau: "#2455c3",
  dunkelblau: "#142b63",
  flieder: "#d49cf1",
  violett: "#7138b5",
  magenta: "#c52a87",
  rosa: "#e14b9a",
} as const satisfies Record<FLTrikotFarbe, `#${string}`>;

export const TRIKOT_FARBEN: readonly { readonly value: FLTrikotFarbe; readonly label: string; readonly hex: `#${string}` }[] = Object.values(
  FLTrikotFarbe,
).map((value) => ({ value, label: COPY.team.trikotFarbeName[value], hex: TRIKOT_HEX[value] }));

/**
 * The colours as a list's choices, each beside its swatch, a colour `taken` muted and closed with no word why: a
 * season's colour is one team's, and the write refuses a second. It stands here, apart from the administration's
 * list, so the public form's bundle carries no administration words.
 */
export const trikotFarbeOptions = (taken: readonly string[]): readonly Option[] =>
  TRIKOT_FARBEN.map(({ value, label, hex }) => {
    const option = { id: value, label: { record: label }, swatch: hex };
    return taken.includes(value) ? { ...option, isDisabled: true } : option;
  });
