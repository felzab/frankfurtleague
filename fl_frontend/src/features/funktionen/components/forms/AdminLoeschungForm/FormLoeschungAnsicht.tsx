import { joinUnd } from "@/core/joinUnd";
import { rollenLangform } from "@/features/bewerbungen/constants";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";

import type { FLErasureAnsichtResponse } from "@/features/funktionen/schemas";

/** Every record the erasure would reach, as the backend answered it, the transport's own field left behind. */
export type LoeschungAnsicht = Omit<FLErasureAnsichtResponse, "acknowledged">;

const ZEILE_CLASSES = "fluid-xxs leading-normal font-medium text-foreground";

const nameOf = (vorname: string, nachname: string | null): string => (nachname === null ? vorname : `${vorname} ${nachname}`);

/**
 * One line per record, by kind in the order the person's own reveal lists them, each naming whom it holds in words
 * that say nothing of their gender: the reveal is read before anybody knows whose data it is.
 */
export function zeilenOf({
  spieler,
  schiedsrichter,
  sitze,
  bewerbungen,
  registrierungen,
  adresswechsel,
  verwaltung,
}: LoeschungAnsicht): string[] {
  return [
    ...spieler.map(({ vorname, nachname, kader }) => {
      const kaderTeile = kader.map(({ team_name, saison_id }) =>
        team_name === null ? `im Kader der Saison ${saison_id}` : `im Kader von ${team_name} (${saison_id})`,
      );
      const person = `Spielerin oder Spieler: ${nameOf(vorname, nachname)}`;

      return kaderTeile.length === 0 ? person : `${person}, ${joinUnd(kaderTeile)}`;
    }),
    ...schiedsrichter.map(({ name }) =>
      name === null ? "Schiedsrichterin oder Schiedsrichter ohne Namen" : `Schiedsrichterin oder Schiedsrichter: ${name}`,
    ),
    ...sitze.map(
      ({ rolle, team_name, saison_id, vorname, nachname }) =>
        `${rollenLangform([rolle])} bei ${team_name}, Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
    ),
    ...bewerbungen.map(
      ({ rolle, saison_id, vorname, nachname }) =>
        `${rollenLangform([rolle])} in einer Bewerbung für die Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
    ),
    ...registrierungen.map(({ team_name, saison_id, vorname, nachname }) =>
      team_name === null
        ? `Registrierung für die Saison ${saison_id}: ${nameOf(vorname, nachname)}`
        : `Registrierung bei ${team_name}, Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
    ),
    // One line for every pending change, which names no person of its own to list them by.
    ...(adresswechsel.length === 0
      ? []
      : [
          adresswechsel.length === 1
            ? "Eine noch nicht bestätigte Adressänderung auf diese Adresse"
            : `${String(adresswechsel.length)} noch nicht bestätigte Adressänderungen auf diese Adresse`,
        ]),
    ...(verwaltung === null ? [] : [verwaltung === "owner" ? "Zugang zur Verwaltung als Inhaberin oder Inhaber" : "Zugang zur Verwaltung"]),
  ];
}

/**
 * What the erasure of one address reaches, inside its armed reveal: the claim the confirmation rests on. The account
 * is named whatever the read found, the sign-in store answering only once the records are gone.
 */
export function FormLoeschungAnsicht({ ansicht }: { ansicht: LoeschungAnsicht }) {
  const zeilen = zeilenOf(ansicht);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex w-full flex-col gap-y-1">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Unter dieser Adresse wird gelöscht:</h3>

        {zeilen.length === 0 ? (
          <p className={ZEILE_CLASSES}>Unter dieser Adresse ist nichts gespeichert. Gelöscht wird nur ein Konto, falls eines besteht.</p>
        ) : (
          <ul className={`${ZEILE_CLASSES} flex list-disc flex-col gap-y-1 pl-5`}>
            {/* Derived per press and never reordered, which is what makes the index a key: two seats can read alike. */}
            {[...zeilen, "Das Konto der Adresse mit Passkeys und Anmeldungen, falls eines besteht"].map((zeile, stelle) => (
              <li key={stelle}>{zeile}</li>
            ))}
          </ul>
        )}
      </div>

      <p className={ZEILE_CLASSES}>Zurückholen lässt sich das nicht.</p>
    </div>
  );
}
