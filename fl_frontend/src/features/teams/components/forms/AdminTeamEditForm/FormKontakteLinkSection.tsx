"use client";

import Link from "next/link";

import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";

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
  // rather than „Personen“, `trainer_ist_ansprechperson` seating one person twice.
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
        <h2 className={panel.heading()}>
          Kontakte
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
        </h2>
      </div>

      <div className={panel.body()}>
        <Link
          href={href}
          className="text-brand hover:text-brand-solid fluid-sm w-fit font-bold transition-colors">
          {label}
        </Link>
      </div>
    </section>
  );
}
