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
import type { GruppeOffer, TeamGruppeLock, TeamSaisonContext } from "@/features/teams/types";

/** The season's own state, said in one badge beside its id — the app's one wording and one palette. */
function SaisonBadge({ status }: { status: TeamSaisonContext["saisonStatus"] }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>;
}

/**
 * The club's membership of the SELECTED season — the one in the sidemenu's season selector, not a
 * list of every season (decided 2026-08-07): the selector is the page's season context, so switching
 * it switches what this panel shows and writes.
 *
 * **The group is locked once the season is underway.** Moving a club between groups rewrites what
 * its results mean for two tables and the seeding, so the select renders only while the season is
 * `future` or the club has no fixture in it yet (decided 2026-08-07). A locked group is a
 * read-only row naming why; a legal swap of two clubs is a future control, not this select.
 *
 * A club NOT in the season gets exactly one affordance — entering it, with a group — and only while
 * the season is `future` (decided 2026-08-07): a season's field is settled before it starts, so a
 * running or past season shows why there is nothing to do instead. The picker offers the season's
 * own groups with their fill state, full ones disabled; `POST /teams/{team_id}/saisons` refuses the
 * same shapes (REQ-ENTER-001..003) and stays authoritative. Entering fires its own action
 * immediately rather than joining the save bar — it is an event, not a field edit, and it is what
 * creates the row the rest of this panel edits.
 */
export function FormSaisonSection({
  saison,
  gruppeLock,
  gruppeOffer,
  isMember,
  gruppe,
  onGruppeChange,
  onValidateSelection,
  teamId,
}: {
  saison: TeamSaisonContext;
  gruppeLock: TeamGruppeLock;
  /** The season's groups with their fill state (`buildGruppeOffer`) — what the pickers may offer. */
  gruppeOffer: readonly GruppeOffer[];
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
      {/* `relative` + an absolutely placed badge, so the h2 keeps the exact flow every other panel
          heading has — wrapping it in a flex row is what pushed the info glyph off the text's
          baseline (decided 2026-08-07). */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <SaisonBadge status={saison.saisonStatus} />
        </span>
        <h2 className={panel.heading()}>
          Saison {saison.saisonId}
          <InfoHint label="Hinweis zur Saison-Zugehörigkeit">
            <p>Dieser Bereich zeigt und bearbeitet die im Seitenmenü gewählte Saison.</p>
            <ul>
              <li>Um eine andere Saison zu bearbeiten, wähle sie im Seitenmenü aus.</li>
              <li>Eine Mannschaft verlässt eine Saison nie. Der einzige Weg hinaus ist die Disqualifikation unten.</li>
              <li>
                Die <strong>Gruppe</strong> ist nur änderbar, solange die Saison nicht begonnen hat und keine Spiele angesetzt sind.
              </li>
            </ul>
          </InfoHint>
        </h2>
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
                    offer={gruppeOffer}
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
        ) : saison.saisonStatus === "future" ? (
          <div className="flex w-full flex-col gap-y-4">
            <Callout
              severity="info"
              title={`Nicht in Saison ${saison.saisonId}`}>
              Ohne Aufnahme erscheint das Team in dieser Saison auf keiner Seite, weder in einer Tabelle noch in einer Auswahlliste.
            </Callout>
            <div className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,15rem)_auto]">
              <GruppeSelect
                value={gruppe}
                onChange={onGruppeChange}
                offer={gruppeOffer}
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
        ) : (
          // No entry affordance at all outside a planned season (decided 2026-08-07): a season's
          // field is settled before it starts. The junction write refuses the same (REQ-ENTER-001).
          <Callout
            severity="info"
            title={`Nicht in Saison ${saison.saisonId}`}>
            Teams können nur in eine geplante Saison aufgenommen werden. Diese Saison
            {saison.saisonStatus === "active" ? " läuft bereits" : " ist beendet"}, ihr Teilnehmerfeld steht fest.
          </Callout>
        )}
      </div>
    </section>
  );
}
