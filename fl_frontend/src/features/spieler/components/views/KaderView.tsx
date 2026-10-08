import { KaderList } from "@/features/spieler/components/collections/KaderList";
import { KADER_LEER } from "@/features/spieler/constants";
import { EmptyState } from "@/shared/components/ui/EmptyState";

import type { FLKaderZeile } from "@/features/spieler/schemas";

/** A team's squad on its seat holder's panel: every row the season holds, the ausgetragen ones read-only. */
export function KaderView({
  kader,
  kaderHref,
  registrierungenHref,
}: {
  kader: readonly FLKaderZeile[];
  kaderHref: string;
  /** The team's pending registrations, the one way a pupil reaches this squad from the seat holder's side. */
  registrierungenHref: string;
}) {
  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        {kader.length === 0 ? (
          <EmptyState
            title={KADER_LEER}
            hint="Wer sich über den Link Deines Teams registriert, kommt über die Registrierungen in den Kader."
            aktion={{ href: registrierungenHref, label: "Zu den Registrierungen" }}
          />
        ) : (
          <KaderList
            kader={kader}
            kaderHref={kaderHref}
          />
        )}
      </div>
    </div>
  );
}
