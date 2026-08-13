"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft, LockFill } from "@gravity-ui/icons";

import { Button, Label, ListBox, Select } from "@heroui/react";

import { swapGruppenAction } from "@/features/saisons/actions";
import { findSwapPartnerRefusal } from "@/features/saisons/utils";
import { postSaisonTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { appToast } from "@/shared/utils/appToast";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "@/features/saisons/types";
import type { SwapPartnerRefusal } from "@/features/saisons/utils";
import type { FLGruppenNames } from "@/features/teams/schemas";
import type { GruppeOffer, TeamGruppeLock, TeamSaisonContext } from "@/features/teams/types";
import type { Key } from "@heroui/react";
import type { TeamBanner } from "./banners";

/** The sentence the disabled swap button is described by. This control renders at most once per page. */
const SWAP_BUTTON_HINT_ID = "gruppentausch-team-hinweis";

/**
 * This control's wording for each refusal `findSwapPartnerRefusal` returns.
 *
 * Different words from the season panel's for the same codes, and deliberately: here one side is fixed
 * and named at the top of the page, so a row can say what is true of the club in it rather than what is
 * true of the pair. `self` never renders — the fixed club is not offered as its own partner.
 */
const PARTNER_REFUSAL_LABEL: Record<SwapPartnerRefusal, string> = {
  self: "diese Mannschaft",
  sameGruppe: "gleiche Gruppe",
  played: "hat schon gespielt",
  spieltagClash: "zweimal am Spieltag",
};

/** The season's own state, said in one badge beside its id — the app's one wording and one palette. */
function SaisonBadge({ status }: { status: TeamSaisonContext["saisonStatus"] }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>;
}

/**
 * The group swap with ONE side already decided — the club editor's entry point into the swap the
 * season editor owns (ADR-0071).
 *
 * **One picker, because the page has already answered "which club".** That is the whole difference from
 * `FormGruppenSwapSection`: this surface's subject is a club, so asking for it again is the shape
 * ADR-0062 measured the club editor against and rejected. It writes the same
 * `POST /saisons/{saison_id}/gruppen/swap` in the same single transaction, and `REQ-ENTER-004`'s lock
 * above it is neither consulted nor relaxed.
 *
 * **The offer is graded by the shared rule** (`findSwapPartnerRefusal`), so a club this picker accepts
 * is one the endpoint accepts (ADR-0038). Everything that refuses every pair alike — a finished season,
 * a knockout that has begun, this club having played its own group — closes the control instead, because
 * a per-row reason would send an admin to look at the wrong club.
 */
function GruppenTauschControl({
  saisonId,
  saisonStatus,
  swap,
  self,
}: {
  saisonId: string;
  saisonStatus: TeamSaisonContext["saisonStatus"];
  swap: SaisonGruppenSwapContext;
  /** This page's club, as it stands in this season — the side the admin does not choose. */
  self: SaisonSwapTeam;
}) {
  const router = useRouter();
  const [isSwapping, startSwapping] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [partner, setPartner] = useState<SaisonSwapTeam | null>(null);

  // Every other club of the season, each carrying why it cannot be taken — visible and disabled rather
  // than absent, which is `GruppeSelect`'s rule: an admin should see why a club cannot be chosen instead
  // of wondering where it went.
  const candidates = swap.teams.filter((team) => team.id !== self.id).map((team) => ({ team, refusal: findSwapPartnerRefusal(self, team) }));
  const hasAPartner = candidates.some(({ refusal }) => refusal === null);

  const handlePick = (key: Key | null) => {
    const picked = candidates.find(({ team }) => team.id === key?.toString());
    if (picked === undefined || picked.refusal !== null) return;
    setPartner(picked.team);
    setIsConfirming(false);
  };

  const handleSwap = () => {
    if (partner === null) return;

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startSwapping(async () => {
      const res = await swapGruppenAction({ saison_id: saisonId, team1_id: self.id, team2_id: partner.id });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Tausch fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      appToast.success("Gruppen getauscht", { description: res.message });
      setPartner(null);
      // The action invalidates the caches; this re-renders the page the admin is still standing on,
      // whose locked group row now has to show the group the swap produced.
      router.refresh();
    });
  };

  return (
    <div className="border-border flex w-full flex-col gap-y-3 border-t pt-5">
      {/* A sub-group of the Saison panel rather than a panel of its own: it edits the row above it,
          and a second bordered box for one picker would read as a second subject. */}
      <p className={FORM_SECTION_HEADING}>Gruppe tauschen</p>

      {/* The whole-control closures, in the endpoint's own order — season, then bracket, then this
          club's own round robin (ADR-0062). Each refuses every pair alike, so none of them is a row. */}
      {saisonStatus === "past" ? (
        <Callout
          severity="info"
          title="Die Saison ist abgeschlossen">
          Auch ein Tausch geht jetzt nicht mehr. Die Tabellen dieser Saison bleiben so, wie sie am Saisonende standen.
        </Callout>
      ) : swap.playedKnockoutSpiele > 0 ? (
        <Callout
          severity="info"
          title="Die KO-Runde hat begonnen">
          {swap.playedKnockoutSpiele === 1
            ? "Ein Spiel der KO-Runde wurde schon gespielt oder abgesagt."
            : `${String(swap.playedKnockoutSpiele)} Spiele der KO-Runde wurden schon gespielt oder abgesagt.`}{" "}
          Die Setzung ist aus diesen Gruppen entstanden, deshalb lässt sich jetzt keine Gruppe mehr tauschen.
        </Callout>
      ) : self.gespielteGruppenSpiele > 0 ? (
        <Callout
          severity="info"
          title={`${self.name} hat in ihrer Gruppe schon gespielt`}>
          {self.gespielteGruppenSpiele === 1
            ? `Ein Spiel in Gruppe ${self.gruppe} wurde schon gespielt oder abgesagt.`
            : `${String(self.gespielteGruppenSpiele)} Spiele in Gruppe ${self.gruppe} wurden schon gespielt oder abgesagt.`}{" "}
          Eine Gruppe ist ein Rundenturnier, in dem jede Mannschaft gegen jede andere ihrer Gruppe spielt — wer darin gespielt hat, gehört
          dorthin.
        </Callout>
      ) : !hasAPartner ? (
        <Callout
          severity="info"
          title="Zurzeit ist keine Mannschaft wählbar">
          Tauschen kann nur, wer in einer anderen Gruppe dieser Saison steht und dort noch kein Spiel gespielt oder abgesagt bekommen hat. Auf
          keine Mannschaft dieser Saison trifft das gerade zu.
        </Callout>
      ) : (
        <>
          <p className="fluid-sm text-foreground font-medium">
            <strong>{self.name}</strong> steht in Gruppe {self.gruppe}. Wähle die Mannschaft, mit der die Gruppe getauscht wird — beide wechseln
            in einem Schritt.
          </p>

          <div className="flex w-full flex-col gap-y-1.5">
            <Select
              aria-label="Tauschen mit"
              value={partner?.id ?? undefined}
              onChange={handlePick}
              isDisabled={isSwapping}
              className="w-full sm:max-w-96">
              {/* HeroUI's own `Label`, so `for`/`id` reach the trigger — see `FormGruppenSwapSection`. */}
              <Label className={FIELD_LABEL}>Tauschen mit</Label>
              <Select.Trigger className={`${FIELD_TRIGGER} mt-1.5 w-full justify-between`}>
                {/* From the prop rather than `Select.Value`: the collection can lag a render behind and
                would show HeroUI's English placeholder — `GruppeSelect`'s reason. */}
                <span className={partner ? "" : "text-foreground-muted"}>
                  {partner ? `${partner.name} — Gruppe ${partner.gruppe}` : "Mannschaft wählen"}
                </span>
                <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
              </Select.Trigger>
              <Select.Popover className={`${overlayPanel()} mt-2 max-h-72 overflow-y-auto p-1.5`}>
                <ListBox aria-label="Mannschaften dieser Saison">
                  {candidates.map(({ team, refusal }) => (
                    <ListBox.Item
                      key={team.id}
                      id={team.id}
                      textValue={team.name}
                      isDisabled={refusal !== null}
                      className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40">
                      <span className="min-w-0 truncate">{team.name}</span>
                      <span className="fluid-xs text-foreground-muted shrink-0 font-semibold">
                        {refusal === null ? `Gruppe ${team.gruppe}` : PARTNER_REFUSAL_LABEL[refusal]}
                      </span>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            {/* Why a row is grey, and why a club an admin expects is not in the list at all — the two
            questions this picker raises, answered where it raises them. */}
            <p className="fluid-xxs text-foreground-muted leading-normal font-medium">
              Ausgegraut heißt: gleiche Gruppe, in ihrer Gruppe schon gespielt, oder eine der beiden stünde nach dem Tausch zweimal an einem
              Spieltag. Mannschaften, die nicht in dieser Saison stehen, haben hier keine Gruppe und erscheinen deshalb nicht.
            </p>
          </div>

          {partner !== null && (
            <Callout
              severity="warning"
              title="Das passiert beim Tausch">
              <strong>{self.name}</strong> steht danach in Gruppe {partner.gruppe}, <strong>{partner.name}</strong> in Gruppe {self.gruppe}.
              Beide übernehmen dabei die angesetzten Spiele der anderen — mit Gegner, Termin und Ort. Die Tabellen beider Gruppen ändern sich
              sofort.
            </Callout>
          )}

          {/* Escalated in place, the season panel's shape: without `role="alert"` the only signal is the
          button label quietly changing. */}
          {isConfirming && partner !== null && (
            <div
              role="alert"
              className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm`}>
              <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
              <p className="fluid-xxs text-foreground leading-normal font-medium">
                Der Tausch gilt sofort, unabhängig vom Speichern-Knopf unten, und ist auf jeder Tabelle dieser Saison sichtbar. Rückgängig
                machst Du ihn, indem Du dieselben beiden Mannschaften noch einmal tauschst.
              </p>
            </div>
          )}

          <div className="flex w-full flex-col gap-y-1.5">
            <div className="flex w-full flex-row flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                aria-describedby={!isSwapping && partner === null ? SWAP_BUTTON_HINT_ID : undefined}
                isDisabled={isSwapping || partner === null}
                onPress={handleSwap}
                className={`${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`}>
                {!isConfirming && (
                  <ArrowRightArrowLeft
                    aria-hidden="true"
                    width={18}
                    height={18}
                  />
                )}
                {isSwapping ? "Tauscht..." : isConfirming ? "Ja, Gruppen tauschen" : "Gruppen tauschen"}
              </Button>
              {isConfirming && (
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={isSwapping}
                  onPress={() => setIsConfirming(false)}
                  className={formButton({ intent: "cancel" })}>
                  Abbrechen
                </Button>
              )}
            </div>
            {/* Adjacent to the control it describes and pointed at by `aria-describedby` — the treatment
            `FormErgebnisSection` established for a control disabled for a reason already on screen. */}
            {!isSwapping && partner === null && (
              <p
                id={SWAP_BUTTON_HINT_ID}
                className="fluid-xxs text-foreground-muted leading-normal font-medium">
                Wähle zuerst eine Mannschaft zum Tauschen.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The club's membership of the SELECTED season — the one in the sidemenu's season selector, not a
 * list of every season (decided 2026-08-07): the selector is the page's season context, so switching
 * it switches what this panel shows and writes.
 *
 * **The group is locked once the season is underway.** Moving a club between groups rewrites what
 * its results mean for two tables and the seeding, so the select renders only while the season is
 * `future` or the club has no fixture in it yet (decided 2026-08-07). A locked group is a read-only
 * row naming why, and directly under it the operation that name refers to: a swap of two clubs, which
 * is the one mid-season group change that keeps both groups whole (ADR-0062, ADR-0071).
 *
 * **The swap control appears only while the group is locked**, because that is the state it answers.
 * With the picker still free a direct change is both legal and simpler, and offering two routes to one
 * outcome would be the page asking the admin to choose between them.
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
  swap,
  teamId,
  banners,
}: {
  saison: TeamSaisonContext;
  gruppeLock: TeamGruppeLock;
  /** The editor's whole Hinweis list; the three spots below take their own entries out of it. */
  banners: readonly TeamBanner[];
  /** The season's groups with their fill state (`buildGruppeOffer`) — what the pickers may offer. */
  gruppeOffer: readonly GruppeOffer[];
  isMember: boolean;
  gruppe: FLGruppenNames | null;
  onGruppeChange: (next: FLGruppenNames) => void;
  onValidateSelection: (paths: readonly string[], selected: { gruppe: FLGruppenNames }) => void;
  /** The selected season's swap state, from `buildGruppenSwapContext` (ADR-0071). */
  swap: SaisonGruppenSwapContext;
  teamId: string;
}) {
  const panel = formPanel();
  const [isEntering, startEntering] = useTransition();

  // The page's club as the swap sees it. Absent while the club holds no junction row for this season,
  // which is the state the entry affordance below answers instead.
  const self = swap.teams.find((team) => team.id === teamId) ?? null;

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
              <li>
                Eine <strong>andere Saison</strong> wählst Du im Seitenmenü aus.
              </li>
              <li>
                Die <strong>Disqualifikation</strong> unten ist der einzige Weg aus einer Saison.
              </li>
              <li>
                Die <strong>Gruppe</strong> ist nur änderbar, solange die Saison nicht begonnen hat und keine Spiele angesetzt sind.
              </li>
              <li>
                Danach bleibt genau ein Weg: der <strong>Tausch</strong> mit einer zweiten Mannschaft, hier oder auf der Saisonseite. Beide
                wechseln in einem Schritt, damit jede Gruppe ihre Größe behält.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {isMember ? (
          gruppeLock.locked ? (
            <>
              <div className="flex w-full flex-col gap-y-1">
                <TeamFieldLabel path="gruppe">Gruppe</TeamFieldLabel>
                <div className="border-border bg-muted/40 text-foreground fluid-sm flex h-10 w-full items-center gap-x-2 rounded-lg border px-3 font-bold sm:max-w-60">
                  <LockFill className="text-foreground-muted size-3.5 shrink-0" />
                  {gruppe ? `Gruppe ${gruppe}` : "—"}
                </div>
              </div>

              {/* Why the row is locked is the swap control's to say: the lock is one condition where
                  the swap grades four, so a second sentence here can only be the one that disagrees.
                  It renders wherever the lock does — a locked group implies a membership. */}
              {self !== null && (
                <GruppenTauschControl
                  saisonId={saison.saisonId}
                  saisonStatus={saison.saisonStatus}
                  swap={swap}
                  self={self}
                />
              )}
            </>
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

              <InlineBanners
                banners={banners}
                spot="gruppe"
              />
            </>
          )
        ) : saison.saisonStatus === "future" ? (
          <div className="flex w-full flex-col gap-y-4">
            <InlineBanners
              banners={banners}
              spot="saison-eintritt"
            />
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
          <InlineBanners
            banners={banners}
            spot="saison-gesperrt"
          />
        )}
      </div>
    </section>
  );
}
