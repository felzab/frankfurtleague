import Link from "next/link";

import { joinUnd } from "@/core/joinUnd";
import { rollenLangform } from "@/features/bewerbungen/constants";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import type { FLErasureAnsichtResponse } from "@/features/funktionen/schemas";

/** Every record the erasure would reach, as the backend answered it, the transport's own field left behind. */
export type LoeschungAnsicht = Omit<FLErasureAnsichtResponse, "acknowledged">;

/** One line of the reveal, and the record's own page where the line names no person to recognise it by. */
type Zeile = { readonly text: string; readonly href?: string };

const ZEILE_CLASSES = "fluid-xxs leading-normal font-medium text-foreground";

const nameOf = (vorname: string, nachname: string | null): string => (nachname === null ? vorname : `${vorname} ${nachname}`);

/**
 * One line per record, by kind in the order the person's own reveal lists them, each naming whom it holds in words
 * that say nothing of their gender: the reveal is read before anybody knows whose data it is.
 */
function zeilenOf(
  { spieler, schiedsrichter, sitze, bewerbungen, registrierungen, adresswechsel, spieler_adresswechsel, verwaltung }: LoeschungAnsicht,
  saisonHref: (path: string) => string,
): Zeile[] {
  return [
    ...spieler.map(({ vorname, nachname, kader }) => {
      const kaderTeile = kader.map(({ team_name, saison_id }) =>
        team_name === null ? `im Kader der Saison ${saison_id}` : `im Kader von ${team_name} (${saison_id})`,
      );
      const person = `Spielerin oder Spieler: ${nameOf(vorname, nachname)}`;

      return { text: kaderTeile.length === 0 ? person : `${person}, ${joinUnd(kaderTeile)}` };
    }),
    ...schiedsrichter.map(({ name }) => ({
      text: name === null ? "Schiedsrichterin oder Schiedsrichter ohne Namen" : `Schiedsrichterin oder Schiedsrichter: ${name}`,
    })),
    ...sitze.map(({ rolle, team_name, saison_id, vorname, nachname }) => ({
      text: `${rollenLangform([rolle])} bei ${team_name}, Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
    })),
    ...bewerbungen.map(({ rolle, saison_id, vorname, nachname }) => ({
      text: `${rollenLangform([rolle])} in einer Bewerbung für die Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
    })),
    ...registrierungen.map(({ team_name, saison_id, vorname, nachname }) => ({
      text:
        team_name === null
          ? `Registrierung für die Saison ${saison_id}: ${nameOf(vorname, nachname)}`
          : `Registrierung bei ${team_name}, Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
    })),
    // A pending change names no person of its own, so its line opens the record it waits on.
    ...adresswechsel.map(({ schiedsrichter_id }) => ({
      text: "Eine noch nicht bestätigte Adressänderung einer Schiedsrichterin oder eines Schiedsrichters auf diese Adresse",
      href: saisonHref(`/bereich/admin/schiedsrichter/${schiedsrichter_id}`),
    })),
    ...spieler_adresswechsel.map(({ spieler_id }) => ({
      text: "Eine noch nicht bestätigte Adressänderung einer Spielerin oder eines Spielers auf diese Adresse",
      href: saisonHref(`/bereich/admin/spieler/${spieler_id}`),
    })),
    ...(verwaltung === null
      ? []
      : [{ text: verwaltung === "owner" ? "Zugang zur Verwaltung als Inhaberin oder Inhaber" : "Zugang zur Verwaltung" }]),
  ];
}

/**
 * What the erasure of one address reaches, inside its armed reveal: the claim the confirmation rests on. The account
 * is named whatever the read found, the sign-in store answering only once the records are gone.
 */
export function FormLoeschungAnsicht({ ansicht }: { ansicht: LoeschungAnsicht }) {
  const saisonHref = useSaisonHref();
  const zeilen = zeilenOf(ansicht, saisonHref);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex w-full flex-col gap-y-1">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was dabei gelöscht wird</h3>

        {zeilen.length === 0 ? (
          <p className={ZEILE_CLASSES}>Unter dieser Adresse ist nichts gespeichert. Gelöscht wird nur ein Konto, falls eines besteht.</p>
        ) : (
          <ul className={`${ZEILE_CLASSES} flex list-disc flex-col gap-y-1 pl-5`}>
            {/* Derived per press and never reordered, which is what makes the index a key: two seats can read alike. */}
            {[...zeilen, { text: "Das Konto der Adresse mit Passkeys und Anmeldungen, falls eines besteht" }].map(({ text, href }, stelle) => (
              <li key={stelle}>
                {href === undefined ? (
                  text
                ) : (
                  <Link
                    href={href}
                    prefetch={false}
                    className={textLink()}>
                    {text}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={ZEILE_CLASSES}>Zurückholen lässt sich das nicht.</p>
    </div>
  );
}
