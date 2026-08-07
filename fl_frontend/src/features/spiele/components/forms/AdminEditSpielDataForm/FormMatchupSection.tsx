import { useMemo } from "react";

import { Separator } from "@heroui/react";

import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { collectUsedQuelleKeys } from "../../../utils";
import { FormTeamPicker } from "./FormTeamPicker";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLPatchSpielDataPayload, FLSpiel, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";

/**
 * Who plays: one source-first control per side.
 *
 * **Before Ergebnis, and the Ergebnis panel's own hint is the argument.** It reads "Erst wenn beide
 * Seiten feststehen", because `PATCH /spiele/{spiel_id}` reads through an absent side as no goals at all
 * and a fixture with an unresolved slot can never carry a result (ADR-0041). A panel that states its own
 * precondition cannot sit above it.
 *
 * Each picker disables whichever team the other side already holds, so a match cannot be a team against
 * itself. The rule is unconditional because two unresolved sides are two nulls rather than one team
 * document occupying both (ADR-0041), and `null` disables nothing. The other side's DRAFT source rides
 * along the same way, so the two sides cannot pick one outcome.
 *
 * A Gruppenphase fixture shows two team pickers and no source controls at all — its sides are drawn by
 * the schedule, and offering wiring there would offer a mechanism the write path refuses (ADR-0046).
 */
export function FormMatchupSection({
  spielData,
  saisonSpiele,
  teams,
  knockoutTeamIds,
  spieltagOccupancy,
  team1Payload,
  onTeam1Change,
  team2Payload,
  onTeam2Change,
  team1Quelle,
  onTeam1QuelleChange,
  team2Quelle,
  onTeam2QuelleChange,
  onValidateSelection,
}: {
  /** The fixture as it was opened — its phase gates the source controls, its stored sides anchor
   * both the result-toggle restore and the automatic sides' payload (ADR-0046). */
  spielData: FLSpiel;
  saisonSpiele: FLSpiel[];
  teams: FLTeam[];
  /** Teams the bracket already fields — the qualification proxy, computed by the form. */
  knockoutTeamIds: ReadonlySet<string>;
  /**
   * Which fixture of the same Spieltag already fields each team, computed by the form.
   *
   * Lifted rather than derived here, because the form reads it too: a save refused for fielding a
   * team twice has to land on the same side the picker would have disabled (ADR-0052), and two
   * derivations of "who is already playing" would eventually put the chip on one side and the error
   * on the other.
   */
  spieltagOccupancy: ReadonlyMap<string, number>;
  team1Payload: FLSpielTeamField | null;
  onTeam1Change: (payload: FLSpielTeamField | null) => void;
  team2Payload: FLSpielTeamField | null;
  onTeam2Change: (payload: FLSpielTeamField | null) => void;
  team1Quelle: FLSpielQuelle | null;
  onTeam1QuelleChange: (value: FLSpielQuelle | null) => void;
  team2Quelle: FLSpielQuelle | null;
  onTeam2QuelleChange: (value: FLSpielQuelle | null) => void;
  onValidateSelection: (paths: readonly string[], selected: Partial<FLPatchSpielDataPayload>) => void;
}) {
  const styles = formPanel();

  // Every source another fixture's slot already holds. Memoised by hand because the React Compiler
  // is deliberately off (see `next.config.ts`): the set is rebuilt from ~30 fixtures otherwise on
  // every keystroke anywhere in the form.
  const usedQuelleKeys = useMemo(() => collectUsedQuelleKeys(saisonSpiele, spielData.id), [saisonSpiele, spielData.id]);

  const isKnockout = spielData.saison_phase !== "gruppenphase";

  return (
    <section
      className={styles.root()}
      onKeyDownCapture={suppressEnterSubmit}>
      {/* This InfoHint is where the team-source vocabulary is explained — it used to be spread over a
          `Description` per control, which is the "too much text" the owner reported. The fields keep
          only what is needed while filling them in. */}
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Begegnung
          <InfoHint label="Hinweis zur Begegnung">
            {isKnockout ? (
              <>
                <p>Jede Seite hat eine Herkunft:</p>
                <ul>
                  <li>
                    <strong>Sieger / Verlierer eines Spiels:</strong> folgt automatisch dem Ausgang der früheren Runde.
                  </li>
                  <li>
                    <strong>Platz in einer Gruppe:</strong> folgt automatisch der Abschlusstabelle.
                  </li>
                  <li>
                    <strong>Manuell gesetzt:</strong> bleibt stehen, wie Du es einträgst.
                  </li>
                </ul>
                <p>Wählbar sind nur frühere Runden, deren Ausgang noch kein anderes Spiel belegt.</p>
              </>
            ) : (
              <>
                <p>Welche beiden Mannschaften aufeinandertreffen.</p>
                <ul>
                  <li>
                    <strong>Disqualifizierte</strong> Teams bleiben sichtbar, sind aber gesperrt.
                  </li>
                  <li>
                    Ein Team spielt <strong>einmal pro Spieltag</strong>. Steht es schon in einem anderen Spiel, ist es hier gesperrt.
                  </li>
                </ul>
              </>
            )}
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        <FormTeamPicker
          label="Team 1"
          fieldName="team1"
          teams={teams}
          teamPayload={team1Payload}
          onTeamChange={onTeam1Change}
          quelle={team1Quelle}
          onQuelleChange={onTeam1QuelleChange}
          disabledTeamId={team2Payload?.team_id}
          spielData={spielData}
          saisonSpiele={saisonSpiele}
          usedQuelleKeys={usedQuelleKeys}
          spieltagOccupancy={spieltagOccupancy}
          knockoutTeamIds={knockoutTeamIds}
          otherDraftQuelle={team2Quelle}
          onValidateSelection={onValidateSelection}
        />

        <Separator className="bg-border h-px w-full" />

        <FormTeamPicker
          label="Team 2"
          fieldName="team2"
          teams={teams}
          teamPayload={team2Payload}
          onTeamChange={onTeam2Change}
          quelle={team2Quelle}
          onQuelleChange={onTeam2QuelleChange}
          disabledTeamId={team1Payload?.team_id}
          spielData={spielData}
          saisonSpiele={saisonSpiele}
          usedQuelleKeys={usedQuelleKeys}
          spieltagOccupancy={spieltagOccupancy}
          knockoutTeamIds={knockoutTeamIds}
          otherDraftQuelle={team1Quelle}
          onValidateSelection={onValidateSelection}
        />
      </div>
    </section>
  );
}
