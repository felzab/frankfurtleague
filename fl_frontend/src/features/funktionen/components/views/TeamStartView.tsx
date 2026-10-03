import { joinUnd } from "@/core/joinUnd";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";

import type { FLTeamSitz } from "../../schemas";
import type { TeamSeat } from "../../teamSeats";

/** One seat's line: who holds it and whether they confirmed, or that nobody does. */
function sitzZeile(sitz: FLTeamSitz, langform: string): string {
  // Named rather than left out: a missing line would tell the reader the team has two seats.
  if (sitz.name === null) return `${langform}: nicht besetzt`;

  return `${sitz.name} · ${langform} · ${sitz.bestaetigt ? "bestätigt" : "noch nicht bestätigt"}`;
}

/**
 * A team's landing: the team as it played that season, the person's own roles there, and one line per
 * seat. Never empty, since the reader holds one of the seats it lists.
 */
export function TeamStartView({
  seats: [erster, ...weitere],
  sitze,
}: {
  seats: readonly [TeamSeat, ...TeamSeat[]];
  sitze: readonly FLTeamSitz[];
}) {
  const gehalten = new Set([erster, ...weitere].map((seat) => seat.rolle));
  // A sentence takes each role's long form, in `KONTAKT_ROLLEN`'s order rather than the lookup's.
  const rollen = joinUnd(KONTAKT_ROLLEN.filter((rolle) => gehalten.has(rolle.value)).map((rolle) => rolle.langform));
  // In the order the sentence above names roles, whatever order the read answers in.
  const zeilen = KONTAKT_ROLLEN.flatMap((rolle) =>
    sitze.filter((sitz) => sitz.rolle === rolle.value).map((sitz) => ({ rolle: sitz.rolle, text: sitzZeile(sitz, rolle.langform) })),
  );

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <div className="flex flex-col gap-3">
          {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
          <h2 className={`fluid-2xl font-extrabold tracking-tight text-foreground ${NAME_WRAP_CLASSES}`}>{erster.team_name}</h2>
          <p className="fluid-base text-foreground">Du bist hier als {rollen} eingetragen.</p>
        </div>
        <section
          aria-labelledby="team-kontaktpersonen"
          className="flex flex-col gap-3">
          <h3
            id="team-kontaktpersonen"
            className="fluid-lg font-bold text-foreground">
            Kontaktpersonen
          </h3>
          <ul className="flex flex-col gap-2">
            {zeilen.map(({ rolle, text }) => (
              <li
                key={rolle}
                className={`fluid-base text-foreground ${NAME_WRAP_CLASSES}`}>
                {text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
