"use client";

import { EINSEHBAR_VERWEHRT } from "@/features/adresswechsel/einsehbar";
import { rollenLangform } from "@/features/bewerbungen/constants";
import { SPERRE_ANSICHT_COPY, SPERRE_ANSICHT_VERWEISE, spieleNeuBesetzen } from "@/features/sperrliste/constants";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { NewTabLink } from "@/shared/components/ui/NewTabLink";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatSpielDatum } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { SperreAnsicht } from "@/features/sperrliste/actions";

type Verweis = { readonly label: string; readonly href: string };

/** One record the address still holds, and the tools that act on it, in the order they are pressed. */
type Eintrag = { readonly text: string; readonly verweise: readonly Verweis[] };

type SaisonHref = (path: string) => string;

/**
 * One builder per kind the reveal serves, so a kind it gains fails the type check until it is listed here: a record
 * left off this list stays in place unnoticed, nobody holding the address once the dialog closes.
 */
type Eintraege = { readonly [Art in keyof SperreAnsicht]: (records: SperreAnsicht[Art], saisonHref: SaisonHref) => Eintrag[] };

const ZEILE_CLASSES = "fluid-xxs leading-normal font-medium text-foreground";

const nameOf = (vorname: string, nachname: string | null): string => (nachname === null ? vorname : `${vorname} ${nachname}`);

/* The records' own wording is `fl_frontend/src/features/funktionen/components/forms/AdminLoeschungForm/FormLoeschungAnsicht.tsx`'s,
   which names the same reveal before an erasure, in the order the person's own reveal lists them; a line here adds the
   state that decides its tool, which an erasure needs none of. */
const EINTRAEGE: Eintraege = {
  // A squad row each, at its own season: the pupil editor addresses the selected season's row alone.
  spieler: (spieler, saisonHref) =>
    spieler.flatMap(({ spieler_id, vorname, nachname, kader }): Eintrag[] => {
      const person = `Spielerin oder Spieler: ${nameOf(vorname, nachname)}`;
      if (kader.length === 0) {
        return [
          { text: person, verweise: [{ label: SPERRE_ANSICHT_VERWEISE.eintrag, href: saisonHref(`/bereich/admin/spieler/${spieler_id}`) }] },
        ];
      }

      return kader.map(({ saison_id, team_name, inactive_since }) => {
        const zeile =
          team_name === null ? `${person}, im Kader der Saison ${saison_id}` : `${person}, im Kader von ${team_name}, Saison ${saison_id}`;
        const href = withSaisonId(`/bereich/admin/spieler/${spieler_id}`, saison_id);

        return inactive_since === null
          ? { text: zeile, verweise: [{ label: SPERRE_ANSICHT_VERWEISE.kader, href: href }] }
          : {
              text: `${zeile}, ausgetragen seit ${formatSpielDatum(inactive_since)}`,
              verweise: [{ label: SPERRE_ANSICHT_VERWEISE.eintrag, href: href }],
            };
      });
    }),
  schiedsrichter: (schiedsrichter, saisonHref) =>
    schiedsrichter.map(({ schiedsrichter_id, name, inactive_since, spiele_ohne_ergebnis_saison_ids }) => {
      const person = name === null ? "Schiedsrichterin oder Schiedsrichter ohne Namen" : `Schiedsrichterin oder Schiedsrichter: ${name}`;
      const href = saisonHref(`/bereich/admin/schiedsrichter/${schiedsrichter_id}`);

      return {
        text: inactive_since === null ? person : `${person}, stillgelegt seit ${formatSpielDatum(inactive_since)}`,
        verweise: [
          // At each season holding a booking still to be played, the search reading one season at a time; by the id
          // the referee list's own link carries, never a typed query.
          ...spiele_ohne_ergebnis_saison_ids.map((saisonId) => ({
            label: spieleNeuBesetzen(saisonId),
            href: withSaisonId(`/bereich/admin/spielsuche?schiedsrichter=${schiedsrichter_id}`, saisonId),
          })),
          { label: inactive_since === null ? SPERRE_ANSICHT_VERWEISE.stilllegen : SPERRE_ANSICHT_VERWEISE.eintrag, href: href },
        ],
      };
    }),
  // At the seat's own season: the contacts editor addresses the selected season's three seats alone.
  sitze: (sitze) =>
    sitze.map(({ team_id, saison_id, team_name, rolle, vorname, nachname }) => ({
      text: `${rollenLangform([rolle])} bei ${team_name}, Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
      verweise: [{ label: SPERRE_ANSICHT_VERWEISE.kontakte, href: withSaisonId(`/bereich/admin/kontakte/${team_id}`, saison_id) }],
    })),
  bewerbungen: (bewerbungen, saisonHref) =>
    bewerbungen.map(({ bewerbung_id, saison_id, rolle, vorname, nachname }) => ({
      text: `${rollenLangform([rolle])} in einer Bewerbung für die Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
      verweise: [{ label: SPERRE_ANSICHT_VERWEISE.bewerbung, href: saisonHref(`/bereich/admin/bewerbungen/${bewerbung_id}`) }],
    })),
  // The registrations list serves the pending ones alone, so a declined one is named with no link.
  registrierungen: (registrierungen, saisonHref) =>
    registrierungen.map(({ saison_id, team_name, vorname, nachname, status }) => {
      const art = status === "abgelehnt" ? "Abgelehnte Registrierung" : "Registrierung";

      return {
        text:
          team_name === null
            ? `${art} für die Saison ${saison_id}: ${nameOf(vorname, nachname)}`
            : `${art} bei ${team_name}, Saison ${saison_id}: ${nameOf(vorname, nachname)}`,
        verweise:
          status === "abgelehnt"
            ? []
            : [{ label: SPERRE_ANSICHT_VERWEISE.registrierungen, href: saisonHref("/bereich/admin/registrierungen") }],
      };
    }),
  // A change the tool refuses this reader carries no link there, its line saying where it opens instead.
  adresswechsel: (adresswechsel, saisonHref) =>
    adresswechsel.map(({ adresswechsel_id, einsehbar_verwehrt }) =>
      einsehbar_verwehrt === null
        ? {
            text: "Eine laufende Adressänderung auf diese Adresse",
            verweise: [
              {
                label: SPERRE_ANSICHT_VERWEISE.adresswechsel,
                href: saisonHref(`/bereich/admin/adresswechsel?adresswechsel=${adresswechsel_id}`),
              },
            ],
          }
        : { text: `Eine laufende Adressänderung auf diese Adresse. ${EINSEHBAR_VERWEHRT[einsehbar_verwehrt]}`, verweise: [] },
    ),
};

// A declaration and never a generic arrow: `scripts/checks/docs_gate/copy_rules.py :: copy_spans` reads `= <Art` as
// an element left open, and leaves every string in this file unchecked.

/** One kind's records, its builder and its records correlated through the kind they share. */
function eintraegeDer<Art extends keyof SperreAnsicht>(art: Art, ansicht: SperreAnsicht, saisonHref: SaisonHref): Eintrag[] {
  return EINTRAEGE[art](ansicht[art], saisonHref);
}

/** What the address holds, in the ban's armed reveal ahead of the ban (`docs/frontend/spec.md :: I688`, `:: I724`). */
export function AdminSperreAnsichtList({ ansicht }: { ansicht: SperreAnsicht }) {
  const saisonHref = useSaisonHref();
  const eintraege = (Object.keys(EINTRAEGE) as (keyof SperreAnsicht)[]).flatMap((art) => eintraegeDer(art, ansicht, saisonHref));
  // The edit is asked only where a record has a tool for it. No administrator edits a registration, and a declined one
  // has nothing left for the ban to end: its sentence stands only where one is pending.
  const lead = [
    SPERRE_ANSICHT_COPY.lead,
    ...(eintraege.some(({ verweise }) => verweise.length > 0) ? [SPERRE_ANSICHT_COPY.bearbeiten] : []),
    ...(ansicht.registrierungen.some(({ status }) => status !== "abgelehnt") ? [SPERRE_ANSICHT_COPY.registrierungen] : []),
  ].join(" ");

  return (
    <div className="flex w-full flex-col gap-y-2">
      <h3 className={FORM_SECTION_HEADING_CLASSES}>{SPERRE_ANSICHT_COPY.heading}</h3>

      {eintraege.length === 0 ? (
        <p className={ZEILE_CLASSES}>{SPERRE_ANSICHT_COPY.leer}</p>
      ) : (
        <>
          <p className={ZEILE_CLASSES}>{lead}</p>
          <ul className={`${ZEILE_CLASSES} flex list-disc flex-col gap-y-2 pl-5`}>
            {/* Derived per answer and never reordered, which is what makes the index a key: two seats can read alike. */}
            {eintraege.map(({ text, verweise }, stelle) => (
              <li key={stelle}>
                <span className="flex flex-col gap-y-1">
                  {text}
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {/* Each in a tab of its own: this dialog is the only place the list exists, and it closes with
                        the page the first same-tab link would leave. */}
                    {verweise.map(({ label, href }) => (
                      <NewTabLink
                        key={label}
                        href={href}
                        className={textLink()}>
                        {label}
                      </NewTabLink>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Whatever the read found: the account and the log hold the address past every record, and no read lists them. */}
      <p className={ZEILE_CLASSES}>{SPERRE_ANSICHT_COPY.konto}</p>
      <p className={ZEILE_CLASSES}>{SPERRE_ANSICHT_COPY.protokoll}</p>
    </div>
  );
}
