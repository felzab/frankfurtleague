import { useMemo } from "react";

import { Separator } from "@heroui/react";

import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import { collectUsedQuelleKeys } from "../../../utils";
import { FormTeamPicker } from "./FormTeamPicker";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLPatchSpielDataPayload, FLSpiel, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";
import type { SpielBanner } from "./banners";

/**
 * **Before Ergebnis**, whose hint reads "Erst wenn beide Seiten feststehen". Each picker disables
 * what the other side holds — team and DRAFT source — so a match cannot be a team against itself.
 */
export function FormMatchupSection({
  spielData,
  saisonSpiele,
  teams,
  numberOfGroups,
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
  banners,
}: {
  /** As opened: its phase gates the source controls, its stored sides anchor the restore. */
  spielData: FLSpiel;
  saisonSpiele: FLSpiel[];
  teams: FLTeam[];
  /** The season's `rules.number_of_groups`, bounding each picker's group offer; `null` offers all. */
  numberOfGroups: number | null;
  knockoutTeamIds: ReadonlySet<string>;
  /**
   * Lifted rather than derived here because the form reads it too: two derivations of "who is
   * already playing" would put the chip on one side and the save's refusal on the other.
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
  banners: readonly SpielBanner[];
}) {
  const styles = formPanel();

  // Memoised by hand, the React Compiler being deliberately off: otherwise the set is rebuilt from
  // the whole season on every keystroke anywhere in the form.
  const usedQuelleKeys = useMemo(() => collectUsedQuelleKeys(saisonSpiele, spielData.id), [saisonSpiele, spielData.id]);

  const isKnockout = spielData.saison_phase !== "gruppenphase";

  return (
    <section
      className={styles.root()}
      onKeyDownCapture={suppressEnterSubmit}>
      {/* Where the team-source vocabulary is explained, rather than in a `Description` under every
          control. The fields keep only what is needed while filling them in. */}
      <div className={styles.header()}>
        <PanelHeading
          className={styles.heading()}
          title="Begegnung">
          {/* Two elements rather than one with a conditional body: `hintCap.test.ts` counts a
              literal, and a ternary is a body it cannot measure. What a manual side COSTS is the
              takeover banner's, so this row says only what the choice does. */}
          {isKnockout ? (
            <Hint
              mode="reveal"
              label="Hinweis zur Begegnung"
              body={{
                lead: "Jede Seite hat eine Herkunft.",
                // The one thing no control shows: `FormTeamPicker` drops a taken outcome from the list in silence.
                points: [{ text: "Wählbar sind nur frühere Runden, deren Ausgang noch kein anderes Spiel belegt." }],
              }}
            />
          ) : (
            <Hint
              mode="reveal"
              label="Hinweis zur Begegnung"
              body={{ lead: "Welche beiden Teams aufeinandertreffen." }}
            />
          )}
        </PanelHeading>
      </div>

      <div className={styles.body()}>
        <FormTeamPicker
          label="Team 1"
          fieldName="team1"
          teams={teams}
          numberOfGroups={numberOfGroups}
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
          banners={banners}
        />

        {/* Full-bleed across the body's own padding, so it reads like the header's border
            rather than an inset rule between the two pickers. `w-auto` because
            negative margins and `w-full` overflow together. */}
        <Separator className="bg-border -mx-4 h-px w-auto sm:-mx-5" />

        <FormTeamPicker
          label="Team 2"
          fieldName="team2"
          teams={teams}
          numberOfGroups={numberOfGroups}
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
          banners={banners}
        />
      </div>
    </section>
  );
}
