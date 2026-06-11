import type { SpielPhase, SpielStatus } from "./types";

export const computeSpielStatus = ({ datum, isCanceled, today }: { datum: string | null; isCanceled: boolean; today: string }): SpielStatus => {
  if (isCanceled) return "abgesagt";
  if (datum === null) return "unbekannt";
  if (datum > today) return "ausstehend";
  if (datum === today) return "heute";
  return "vergangen";
};

export const computeSpielPhase = (spielNr: number): SpielPhase => {
  if (spielNr <= 24) return "gruppenphase";
  if (25 <= spielNr && spielNr <= 28) return "viertelfinale";
  if (spielNr === 29 || spielNr === 30) return "halbfinale";
  return "finale";
};
