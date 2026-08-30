"use client";

import Link from "next/link";

import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";

import type { FLSaisonTeamKontakte } from "@/features/teams/schemas";

/**
 * The way to the season's three seats, and no field of them. They answer a different question from
 * the facts around them: a group, a kit colour and an Austritt are what a club DID in a season, and
 * a contact is who to ring about it.
 */
export function FormKontakteLinkSection({
  saisonId,
  kontakte,
  href,
}: {
  saisonId: string;
  /** The season's stored block, read only for the count the link names. */
  kontakte: FLSaisonTeamKontakte | null;
  href: string;
}) {
  const panel = formPanel();

  // Seats HELD, never the three the block always carries: an erasure leaves them empty. And entries
  // rather than „Personen“, `trainer_ist_zugleich` seating one person twice.
  const belegt = KONTAKT_ROLLEN.filter(({ value }) => kontakte?.[value] != null).length;

  // Each count is spelled rather than interpolated into one sentence: `0` and `1` need their own
  // German, and the link's text is also its accessible name.
  const label =
    belegt === 0
      ? `Kontakte für Saison ${saisonId} hinterlegen`
      : belegt === 1
        ? `1 Kontakteintrag für Saison ${saisonId} bearbeiten`
        : `${String(belegt)} Kontakteinträge für Saison ${saisonId} bearbeiten`;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Kontakte">
          <Hint
            mode="reveal"
            label="Hinweis zu den Kontakten"
            body={{
              lead: "Wer für dieses Team in dieser Saison erreichbar ist.",
              points: [
                { term: "Diese Angaben", text: "bleiben in der Verwaltung und erscheinen nirgends öffentlich." },
                { term: "Bearbeitet werden sie", text: "auf einer eigenen Seite, mit einem eigenen Speichern." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {/* The underline is what makes it read as somewhere to go; colour and weight alone did not. No glyph:
            in the admin panel a glyph names a destination, and this one would name none. */}
        <Link
          href={href}
          className={`${textLink()} fluid-sm w-fit font-bold`}>
          {label}
        </Link>
      </div>
    </section>
  );
}
