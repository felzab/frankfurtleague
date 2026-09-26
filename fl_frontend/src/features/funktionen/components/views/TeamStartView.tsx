import { joinUnd } from "@/core/joinUnd";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";

import type { TeamSeat } from "../../teamSeats";

/** A team's landing, from the seats alone: the team as it played that season, and the person's own roles there. */
export function TeamStartView({ seats: [erster, ...weitere] }: { seats: readonly [TeamSeat, ...TeamSeat[]] }) {
  const gehalten = new Set([erster, ...weitere].map((seat) => seat.rolle));
  // A sentence takes each role's long form, in `KONTAKT_ROLLEN`'s order rather than the lookup's.
  const rollen = joinUnd(KONTAKT_ROLLEN.filter((rolle) => gehalten.has(rolle.value)).map((rolle) => rolle.langform));

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-3">
        {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
        <h2 className={`fluid-2xl font-extrabold tracking-tight text-foreground ${NAME_WRAP_CLASSES}`}>{erster.team_name}</h2>
        <p className="fluid-base text-foreground">Du bist hier als {rollen} eingetragen.</p>
      </div>
    </div>
  );
}
