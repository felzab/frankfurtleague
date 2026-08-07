"use client";

import { useTransition } from "react";

import { LockFill } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { postSaisonTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { appToast } from "@/shared/utils/appToast";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { FLGruppenNames } from "@/features/teams/schemas";
import type { TeamGruppeLock, TeamSaisonContext } from "@/features/teams/types";

/** The season's own state, said in one badge beside its id. */
function SaisonBadge({ status }: { status: TeamSaisonContext["saisonStatus"] }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Beendet</span>;
}

/**
 * The club's membership of the SELECTED season — the one in the sidemenu's season selector, not a
 * list of every season (owner, 2026-08-07): the selector is the page's season context, so switching
 * it switches what this panel shows and writes.
 *
 * **The group is locked once the season is underway.** Moving a club between groups rewrites what
 * its results mean for two tables and the seeding, so the select renders only while the season is
 * `future` or the club has no fixture in it yet (owner's rule, 2026-08-07). A locked group is a
 * read-only row naming why; a legal swap of two clubs is a future control, not this select.
 *
 * A club NOT in the season gets exactly one affordance: entering it, with a group. It fires its own
 * action immediately rather than joining the save bar — entering a season is an event, not a field
 * edit, and it is what creates the row the rest of this panel edits.
 */
export function FormSaisonSection({
  saison,
  gruppeLock,
  isMember,
  gruppe,
  onGruppeChange,
  onValidateSelection,
  teamId,
}: {
  saison: TeamSaisonContext;
  gruppeLock: TeamGruppeLock;
  isMember: boolean;
  gruppe: FLGruppenNames | null;
  onGruppeChange: (next: FLGruppenNames) => void;
  onValidateSelection: (paths: readonly string[], selected: { gruppe: FLGruppenNames }) => void;
  teamId: string;
}) {
  const panel = formPanel();
  const [isEntering, startEntering] = useTransition();

  const handleEnterSaison = () => {
    startEntering(async () => {
      const res = await postSaisonTeamAction({ team_id: teamId, saison_id: saison.saisonId, gruppe });
      if (res.success) {
        appToast.success(res.message ?? "Mannschaft aufgenommen!");
      } else if (res.fieldErrors?.gruppe !== undefined) {
        appToast.danger("Aufnehmen fehlgeschlagen", { description: res.fieldErrors.gruppe });
      } else {
        appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
      }
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className={panel.heading()}>
            Saison {saison.saisonId}
            <InfoHint label="Hinweis zur Saison-Zugehörigkeit">
              <p>Dieser Bereich folgt der Saison im Saisonwähler der Seitenleiste.</p>
              <ul>
                <li>Eine Mannschaft verlässt eine Saison nie — der einzige Weg hinaus ist die Disqualifikation unten.</li>
                <li>
                  Die <strong>Gruppe</strong> ist nur änderbar, solange die Saison nicht begonnen hat und keine Spiele angesetzt sind.
                </li>
              </ul>
            </InfoHint>
          </h2>
          <SaisonBadge status={saison.saisonStatus} />
        </div>
      </div>

      <div className={panel.body()}>
        {isMember ? (
          gruppeLock.locked ? (
            <div className="flex w-full flex-col gap-y-1">
              <TeamFieldLabel path="gruppe">Gruppe</TeamFieldLabel>
              <div className="border-border bg-muted/40 text-foreground fluid-sm flex h-10 w-full items-center gap-x-2 rounded-lg border px-3 font-bold sm:max-w-60">
                <LockFill className="text-foreground-muted size-3.5 shrink-0" />
                {gruppe ? `Gruppe ${gruppe}` : "—"}
              </div>
              <p className="fluid-xxs text-foreground-muted font-medium">{gruppeLock.reason}</p>
            </div>
          ) : (
            <>
              <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex w-full flex-col gap-y-1">
                  <TeamFieldLabel path="gruppe">Gruppe</TeamFieldLabel>
                  <GruppeSelect
                    value={gruppe}
                    onChange={(next) => {
                      onGruppeChange(next);
                      onValidateSelection(["gruppe"], { gruppe: next });
                    }}
                    withOwnLabel={false}
                  />
                </div>
              </div>

              {gruppeLock.draftChangesGruppe && (
                <Callout
                  severity="warning"
                  title="Gruppenwechsel wirkt weit">
                  Die Gruppe entscheidet, in welcher Tabelle die Mannschaft steht und welche Setzung sie speist. Ein Wechsel ist nur vertretbar,
                  solange nichts gespielt ist.
                </Callout>
              )}
            </>
          )
        ) : (
          <div className="flex w-full flex-col gap-y-4">
            <Callout
              severity="info"
              title={`Nicht in Saison ${saison.saisonId}`}>
              Ohne Aufnahme erscheint die Mannschaft in dieser Saison auf keiner Seite — weder in einer Tabelle noch in einer Auswahlliste.
            </Callout>
            <div className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,15rem)_auto]">
              <GruppeSelect
                value={gruppe}
                onChange={onGruppeChange}
              />
              <Button
                type="button"
                variant="primary"
                isDisabled={isEntering}
                onPress={handleEnterSaison}
                className={formButton({ intent: "submit" })}>
                {isEntering ? "Speichert..." : `In Saison ${saison.saisonId} aufnehmen`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
