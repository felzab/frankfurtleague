import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { RegistrierungenList } from "@/features/registrierungen/components/collections/RegistrierungenList";
import { REGISTRIERUNGEN_LEER } from "@/features/registrierungen/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { textLink } from "@/shared/components/ui/textLink";
import { FOCUS_HEADING, focusSection } from "@/shared/utils/focusAfterWrite";

import type { FLOffeneRegistrierung } from "@/features/registrierungen/schemas";
import type { Leserichtung } from "@/shared/utils/leserichtung";

/** What a cut-short answer offers: which end of the queue is loaded, and the link to the other one. */
export type RegistrierungenUnvollstaendig = { richtung: Leserichtung; umkehrHref: string };

/**
 * A team's pending registrations on its seat holder's panel, every seat alike. The heading stays when
 * the last row is decided, so the focus has somewhere to land (`docs/frontend/spec.md :: I536`).
 */
export function RegistrierungenView({
  registrierungen,
  adresse,
  unvollstaendig,
}: {
  registrierungen: readonly FLOffeneRegistrierung[];
  adresse: { team_id: string; saison_id: string };
  /** Present only where the read served one end of a longer queue. */
  unvollstaendig: RegistrierungenUnvollstaendig | null;
}) {
  return (
    <div className="w-full p-6 sm:p-8">
      <section
        className="mx-auto flex w-full max-w-page flex-col gap-6"
        {...focusSection("registrierungen")}>
        <div className="flex flex-col gap-3">
          {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
          <h2
            className="fluid-2xl font-extrabold tracking-tight text-foreground"
            {...FOCUS_HEADING}>
            Offene Registrierungen
          </h2>
          {/* The invite is minted and mailed by the administration alone, so the way to a fresh link is the league. */}
          <p className="fluid-base text-foreground">
            Einen neuen Registrierungslink schickt die Liga. Schreib dazu an{" "}
            <Link
              href={`mailto:${KONTAKT_EMAIL}`}
              className={textLink()}>
              {KONTAKT_EMAIL}
            </Link>
            .
          </p>
        </div>

        {unvollstaendig !== null && (
          // Standing and never dismissible: a closed notice would leave a partial queue looking whole.
          <Callout
            severity="warning"
            title="Diese Liste ist unvollständig">
            Geladen sind {unvollstaendig.richtung === "desc" ? "die neuesten" : "die ältesten"} Registrierungen.{" "}
            <Link
              href={unvollstaendig.umkehrHref}
              className={textLink()}>
              Lade {unvollstaendig.richtung === "desc" ? "die ältesten" : "die neuesten"} zuerst
            </Link>
            .
          </Callout>
        )}

        {registrierungen.length === 0 ? (
          <EmptyState title={REGISTRIERUNGEN_LEER} />
        ) : (
          <RegistrierungenList
            registrierungen={registrierungen}
            adresse={adresse}
          />
        )}
      </section>
    </div>
  );
}
