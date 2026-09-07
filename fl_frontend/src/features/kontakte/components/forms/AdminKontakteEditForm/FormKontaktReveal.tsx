import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import type { FLKontaktSitz } from "@/features/kontakte/schemas";

/** The label table's wording rather than a second one, so no two surfaces name a seat differently. */
const rolleLabel = (rolle: FLKontaktSitz["rolle"]): string => KONTAKT_ROLLEN.find((eintrag) => eintrag.value === rolle)?.label ?? rolle;

/**
 * Whom the erasure would reach, listed inside the armed reveal
 * (`fl_frontend/src/shared/components/ui/ConfirmReveal.tsx`).
 *
 * Its own component rendering FROM PROPS because a press is a state no render arrives at
 * (`docs/frontend/spec.md` §1.9), and this list is the claim the confirmation rests on.
 */
export function FormKontaktReveal({
  saison_teams,
  bewerbungen,
}: {
  saison_teams: readonly FLKontaktSitz[];
  bewerbungen: readonly FLKontaktSitz[];
}) {
  // Two clubs of one season can each seat the address, so neither the season nor the role makes a
  // key; the list is derived per press and never reordered, which is what makes the index one.
  const sitze = [
    ...saison_teams.map((sitz) => ({ ort: `Saison ${sitz.saison_id}`, sitz })),
    ...bewerbungen.map((sitz) => ({ ort: `Bewerbung ${sitz.saison_id}`, sitz })),
  ];

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex w-full flex-col gap-y-1">
        <h4 className={FORM_SECTION_HEADING}>Wer dabei gelöscht wird</h4>

        {sitze.length === 0 ? (
          <p className="muted-hint">Diese E-Mail-Adresse steht in keiner Saison und in keiner Bewerbung.</p>
        ) : (
          <dl className="flex w-full flex-col gap-y-1">
            {sitze.map(({ ort, sitz }, stelle) => (
              <ConfirmReadoutRow
                key={stelle}
                label={`${ort} · ${rolleLabel(sitz.rolle)}`}
                value={`${sitz.vorname} ${sitz.nachname}`}
              />
            ))}
          </dl>
        )}
      </div>

      {/* The log is cleared whether or not a seat matched: a person edited out of a row leaves an
          image behind, and „nichts gefunden“ over an empty list would read as „nichts passiert“. */}
      <p className="fluid-xxs text-foreground leading-normal font-medium">
        {sitze.length === 0
          ? "Im Änderungsprotokoll werden gesicherte Stände zu dieser Adresse trotzdem geleert."
          : "Alle aufgeführten Einträge werden geleert, und im Änderungsprotokoll bleibt dazu kein gesicherter Stand."}{" "}
        Zurückholen lässt sich das nicht.
      </p>
    </div>
  );
}
