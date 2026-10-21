import Link from "next/link";

import { joinUnd } from "@/core/joinUnd";
import { HANDLUNGSBEDARF_EINTRAG } from "@/features/admin/constants";
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
  { spieler, schiedsrichter, sitze, bewerbungen, registrierungen, adresswechsel, verwaltung }: LoeschungAnsicht,
  saisonHref: (path: string) => string,
): Zeile[] {
  return [
    ...spieler.map(({ vorname, nachname, kader }) => {
      const kaderTeile = kader.map(({ team_name, saison_id }) =>
        team_name === null ? `im Kader der Saison ${saison_id}` : `im Kader von ${team_name}, Saison ${saison_id}`,
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
    // A pending change names no person of its own, so its line opens the change in the address tool.
    ...adresswechsel.map(({ adresswechsel_id }) => ({
      text: "Eine laufende Adressänderung auf diese Adresse",
      href: saisonHref(`/bereich/admin/adresswechsel?adresswechsel=${adresswechsel_id}`),
    })),
    ...(verwaltung === null
      ? []
      : [{ text: verwaltung === "owner" ? "Zugang zur Verwaltung als Inhaberin oder Inhaber" : "Zugang zur Verwaltung" }]),
  ];
}

/**
 * The person's own erasure page's reasons line, in the third person as this reveal's other lines are. Always named:
 * the reasons are matched by a digest of the address, which no read counts.
 */
const BEGRUENDUNGEN_ZEILE = "Die Begründungen zu Spielterminen, die unter dieser Adresse über einen Bestätigungslink abgegeben wurden";

/**
 * Named on every reveal whatever the read found: the account goes only after the records, and no read lists the
 * log's or the authorship's rewrite. Each reaches an address holding no record, so „nichts gespeichert“ there is false.
 */
const IMMER: readonly Zeile[] = [
  { text: "Das Konto der Adresse mit Passkeys und Anmeldungen, falls eines besteht" },
  { text: BEGRUENDUNGEN_ZEILE },
  { text: "Die Adresse im Änderungsprotokoll und als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen" },
];

/**
 * The one consequence an administrator acts on afterwards: the erased referee's unplayed fixtures stand unassigned.
 * Said only where the reveal found one, the referee's played fixtures moving onto the ghost too.
 */
const NEUE_EINTEILUNG = `Spiele ohne Ergebnis, für die diese Person eingeteilt ist, brauchen danach eine neue Einteilung. Du findest sie dann unter „${HANDLUNGSBEDARF_EINTRAG.label}“.`;

/** What the erasure of one address reaches, inside its armed reveal: the claim the confirmation rests on. */
export function FormLoeschungAnsicht({ ansicht }: { ansicht: LoeschungAnsicht }) {
  const saisonHref = useSaisonHref();
  const zeilen = zeilenOf(ansicht, saisonHref);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex w-full flex-col gap-y-1">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was dabei gelöscht wird</h3>

        {zeilen.length === 0 && <p className={ZEILE_CLASSES}>Unter dieser Adresse ist kein Eintrag gespeichert.</p>}
        <ul className={`${ZEILE_CLASSES} flex list-disc flex-col gap-y-1 pl-5`}>
          {/* Derived per press and never reordered, which is what makes the index a key: two seats can read alike. */}
          {[...zeilen, ...IMMER].map(({ text, href }, stelle) => (
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
      </div>

      {ansicht.schiedsrichter.some(({ spiele_ohne_ergebnis_saison_ids }) => spiele_ohne_ergebnis_saison_ids.length > 0) && (
        <p className={ZEILE_CLASSES}>{NEUE_EINTEILUNG}</p>
      )}
      <p className={ZEILE_CLASSES}>Zurückholen lässt sich das nicht.</p>
    </div>
  );
}
