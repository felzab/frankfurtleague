"use client";

import Link from "next/link";

import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";
import { textLink } from "@/shared/components/ui/textLink";

import { AdminRegistrierungenList } from "../collections/AdminRegistrierungenList";

import type { AdminRegistrierungRow } from "@/features/registrierungen/types";
import type { RegistrierungenUnvollstaendig } from "./RegistrierungenView";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. No address
// among them, the rows carrying none.
const SEARCH_KEYS = ["vorname", "nachname", "teamName", "saison_id", "stufe"] as const;

/** No create control and no decision: a registration is decided by its team, on the team's own page. */
export function AdminRegistrierungenView({
  registrierungen,
  unvollstaendig,
}: {
  registrierungen: AdminRegistrierungRow[];
  /** Present only where the read served one end of a longer queue. */
  unvollstaendig: RegistrierungenUnvollstaendig | null;
}) {
  const andere = unvollstaendig?.richtung === "asc" ? "die neuesten" : "die ältesten";

  return (
    <div className="flex flex-col gap-4">
      {unvollstaendig !== null && (
        // Standing and never dismissible: a closed notice would leave a partial queue looking whole.
        <Callout
          severity="warning"
          title="Diese Liste ist unvollständig">
          Geladen sind {unvollstaendig.richtung === "desc" ? "die neuesten" : "die ältesten"} Registrierungen. Auch die Suche erfasst nur die
          geladenen.{" "}
          <Link
            href={unvollstaendig.umkehrHref}
            className={textLink()}>
            Lade {andere} zuerst
          </Link>
          .
        </Callout>
      )}

      <AdminCrudView<AdminRegistrierungRow>
        items={registrierungen}
        searchKeys={SEARCH_KEYS}
        shape="cards"
        renderTable={({ filteredItems, emptiness }) => (
          <AdminRegistrierungenList
            filteredRegistrierungen={filteredItems}
            emptiness={emptiness}
          />
        )}
      />
    </div>
  );
}
