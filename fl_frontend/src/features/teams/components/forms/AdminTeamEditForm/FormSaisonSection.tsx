"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft, LockFill } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { swapGruppenAction } from "@/features/saisons/actions";
import { findSwapPartnerRefusal } from "@/features/saisons/utils";
import { postSaisonTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { TrikotFarbeSelect } from "@/features/teams/components/forms/TrikotFarbeSelect";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { confirmButton, formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { RefusableSelect } from "@/shared/components/ui/RefusableSelect";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "@/features/saisons/types";
import type { SwapPartnerRefusal } from "@/features/saisons/utils";
import type { FLGruppenNames, FLTrikotFarbe } from "@/features/teams/schemas";
import type { GruppeOffer, TeamGruppeLock, TeamSaisonContext } from "@/features/teams/types";
import type { RefusableOption } from "@/shared/components/ui/RefusableSelect";
import type { TeamBanner } from "./banners";

/** The sentence the disabled swap button is described by. This control renders at most once per page. */
const SWAP_BUTTON_HINT_ID = "gruppentausch-team-hinweis";

/**
 * Different words from the season panel's for the same codes, deliberately: here one side is fixed
 * and named at the top of the page, so a row says what is true of the club in it, not of the pair.
 */
const PARTNER_REFUSAL_LABEL: Record<SwapPartnerRefusal, string> = {
  self: "dieses Team",
  sameGruppe: "gleiche Gruppe",
  played: "hat schon gespielt",
  spieltagClash: "zweimal am Spieltag",
};

/** The app's one wording and one palette for a season's state. */
function SaisonBadge({ status }: { status: TeamSaisonContext["saisonStatus"] }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>;
}

/**
 * The group swap with ONE side already decided — one picker, because the page has answered "which
 * club". Same endpoint, same transaction, and `REQ-ENTER-004`'s lock above it is neither consulted
 * nor relaxed.
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
  const { isConfirming, isPending: isSwapping, press, cancel } = useTwoPressConfirm();
  const [partner, setPartner] = useState<SaisonSwapTeam | null>(null);

  // Graded by the SHARED `findSwapPartnerRefusal`, so a club this picker accepts is one the endpoint
  // accepts. Visible and disabled rather than absent, as `GruppeSelect` does.
  const candidates = swap.teams.filter((team) => team.id !== self.id).map((team) => ({ team, refusal: findSwapPartnerRefusal(self, team) }));
  const hasAPartner = candidates.some(({ refusal }) => refusal === null);

  const options: RefusableOption[] = candidates.map(({ team, refusal }) => ({
    id: team.id,
    name: team.name,
    meta: `Gruppe ${team.gruppe}`,
    refusal: refusal === null ? null : PARTNER_REFUSAL_LABEL[refusal],
  }));

  const handlePick = (id: string) => {
    const picked = candidates.find(({ team }) => team.id === id);
    if (picked === undefined) return;

    setPartner(picked.team);
    cancel();
  };

  const handleSwap = () => {
    // Ahead of `press`, so an unchosen partner neither arms nor writes. `partner` is a `const`, which
    // is what carries the narrowing into the closure below.
    if (partner === null) return;

    press(async () => {
      const res = await swapGruppenAction({ saison_id: saisonId, team1_id: self.id, team2_id: partner.id });

      if (!res.success) {
        appToast.danger("Tausch fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
        return;
      }

      appToast.success("Gruppen getauscht", { description: res.message });
      setPartner(null);
      // Re-renders the page the admin is still standing on, whose locked group row has to show the
      // group the swap produced.
      router.refresh();
    });
  };

  return (
    <div className="border-border flex w-full flex-col gap-y-3 border-t pt-5">
      {/* A sub-group, not a panel of its own: it edits the row above it, and a second bordered box
          for one picker would read as a second subject. */}
      <h3 className={FORM_SECTION_HEADING}>Gruppe tauschen</h3>

      {/* The whole-control closures, in the endpoint's own order. Each refuses every pair alike, so
          none of them is a row. Each title states the rule that shut it rather than the state that
          met it. Dictated wording, shared with the season panel. */}
      {saisonStatus === "past" ? (
        <Callout
          severity="info"
          title="In einer abgeschlossenen Saison ist ein Gruppentausch nicht mehr möglich">
          Die Tabellen dieser Saison bleiben so, wie sie am Saisonende standen.
        </Callout>
      ) : swap.playedKnockoutSpiele > 0 ? (
        <Callout
          severity="info"
          title="Nach dem Beginn der KO-Runde ist ein Gruppentausch nicht mehr möglich"
        />
      ) : self.gespielteGruppenSpiele > 0 ? (
        <Callout
          severity="info"
          title="Wer in seiner Gruppe schon gespielt hat, bleibt in ihr"
        />
      ) : !hasAPartner ? (
        <Callout
          severity="info"
          title="Ein Gruppentausch braucht ein Team aus einer anderen Gruppe, das dort noch kein Spiel gespielt hat"
        />
      ) : (
        <>
          <p className="muted-hint">
            Wähle das Team, mit dem <strong>{self.name}</strong> die Gruppe tauscht.
          </p>

          <div className="flex w-full flex-col gap-y-1.5">
            <RefusableSelect
              label="Tauschen mit"
              placeholder="Team wählen"
              value={options.find((option) => option.id === partner?.id) ?? null}
              options={options}
              onChange={handlePick}
              isDisabled={isSwapping}
              className="sm:max-w-96"
            />

            {/* Why an expected club is missing, answered where the picker raises it. A greyed row
            carries its own reason, so nothing here restates the refusal labels. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Teams, die nicht in dieser Saison stehen, erscheinen hier nicht.
            </p>
          </div>

          {partner !== null && (
            <Callout
              severity="warning"
              title={`${self.name} steht danach in Gruppe ${partner.gruppe}, ${partner.name} in Gruppe ${self.gruppe}`}>
              Beide übernehmen dabei die angesetzten Spiele des anderen, mit Gegner, Termin und Ort. Die Tabellen beider Gruppen ändern sich
              sofort.
            </Callout>
          )}

          {isConfirming && partner !== null && (
            <ConfirmReveal>
              <p className="fluid-xxs text-foreground leading-normal font-medium">
                Der Tausch gilt unabhängig vom Speichern-Knopf unten. Rückgängig machst Du ihn, indem Du dieselben beiden Teams noch einmal
                tauschst.
              </p>
            </ConfirmReveal>
          )}

          <div className="flex w-full flex-col gap-y-1.5">
            <ConfirmActionRow
              isConfirming={isConfirming}
              isPending={isSwapping}
              onCancel={cancel}>
              <Button
                type="button"
                variant="primary"
                aria-describedby={!isSwapping && partner === null ? SWAP_BUTTON_HINT_ID : undefined}
                isDisabled={isSwapping || partner === null}
                onPress={handleSwap}
                className={confirmButton(isConfirming)}>
                {!isConfirming && (
                  <ArrowRightArrowLeft
                    aria-hidden="true"
                    width={18}
                    height={18}
                  />
                )}
                {isSwapping ? "Tauscht..." : isConfirming ? "Ja, Gruppen tauschen" : "Gruppen tauschen"}
              </Button>
            </ConfirmActionRow>
            {/* Adjacent to the control it describes and pointed at by `aria-describedby`, the app's
            treatment for a control disabled for a reason already on screen. */}
            {!isSwapping && partner === null && (
              <Hint
                mode="inline"
                describes={SWAP_BUTTON_HINT_ID}
                text="Wähle zuerst ein Team."
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * **The swap control appears only while the group is locked**, because that is the state it answers:
 * with the picker still free, two routes to one outcome would ask the admin to choose between them.
 */
export function FormSaisonSection({
  saison,
  gruppeLock,
  gruppeOffer,
  isMember,
  isRetired,
  gruppe,
  onGruppeChange,
  onValidateSelection,
  trikotFarbe,
  onTrikotFarbeChange,
  onValidateTrikotSelection,
  swap,
  teamId,
  banners,
}: {
  saison: TeamSaisonContext;
  gruppeLock: TeamGruppeLock;
  banners: readonly TeamBanner[];
  /** The season's groups with their fill state (`buildGruppeOffer`) — what the pickers may offer. */
  gruppeOffer: readonly GruppeOffer[];
  isMember: boolean;
  /**
   * The club's standing in the LEAGUE, not in this season: a stamped `teams.inactive_since`, which
   * the entry write refuses for every season and every group alike (`REQ-ENTER-005`).
   */
  isRetired: boolean;
  gruppe: FLGruppenNames | null;
  onGruppeChange: (next: FLGruppenNames) => void;
  onValidateSelection: (paths: readonly string[], selected: { gruppe: FLGruppenNames }) => void;
  /** The season's kit colour, or null while the club has not named one. */
  trikotFarbe: FLTrikotFarbe | null;
  onTrikotFarbeChange: (next: FLTrikotFarbe | null) => void;
  onValidateTrikotSelection: (paths: readonly string[], selected: { trikot_farbe: FLTrikotFarbe | null }) => void;
  /** The selected season's swap state, from `buildGruppenSwapContext`. */
  swap: SaisonGruppenSwapContext;
  teamId: string;
}) {
  const panel = formPanel();
  const [isEntering, startEntering] = useTransition();

  /**
   * Held here, not in the editor's `useDraftFieldErrors`: its refusal in that map would reach the
   * unsaved-error badge and a `reportValidity()` that moves focus to a form half this branch does
   * not render.
   */
  const [entryGruppeError, setEntryGruppeError] = useState<string | null>(null);

  // The page's club as the swap sees it. Absent while the club holds no junction row for this season,
  // which is the state the entry affordance below answers instead.
  const self = swap.teams.find((team) => team.id === teamId) ?? null;

  // Fires its own action rather than joining the save bar: it is an event, and it creates the
  // junction row the rest of this panel edits.
  const handleEnterSaison = () => {
    startEntering(async () => {
      const res = await postSaisonTeamAction({ team_id: teamId, saison_id: saison.saisonId, gruppe });

      const gruppeError = res.fieldErrors?.gruppe ?? null;
      setEntryGruppeError(gruppeError);

      if (res.success) {
        appToast.success(res.message ?? "Team aufgenommen");
        return;
      }
      // Suppressed where the picker carries the message, so a refusal about the chosen group is not
      // also said in a toast that names no field.
      if (gruppeError === null) {
        appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || UNKNOWN_REFUSAL });
      }
    });
  };

  return (
    <section className={panel.root()}>
      {/* `relative` + an absolutely placed badge, so the h2 keeps every other panel heading's flow;
          a flex row would push the info glyph off the text's baseline. */}
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <SaisonBadge status={saison.saisonStatus} />
        </span>
        <h2 className={panel.heading()}>
          Saison {saison.saisonId}
          <Hint
            mode="reveal"
            label="Hinweis zur Saison-Zugehörigkeit"
            body={{ lead: "Dieser Bereich gilt für die Saison aus dem Seitenmenü." }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        {isMember ? (
          <>
            {gruppeLock.locked ? (
              <div className="flex w-full flex-col gap-y-1">
                <FieldLabel path="gruppe">Gruppe</FieldLabel>
                <div className="border-border bg-muted/40 text-foreground fluid-sm flex h-10 w-full items-center gap-x-2 rounded-lg border px-3 font-bold sm:max-w-60">
                  <LockFill className="text-foreground-muted size-3.5 shrink-0" />
                  {gruppe ? `Gruppe ${gruppe}` : "Keine Gruppe"}
                </div>
              </div>
            ) : (
              <>
                <div className={FIELD_PAIR}>
                  <div className="flex w-full flex-col gap-y-1">
                    <FieldLabel path="gruppe">Gruppe</FieldLabel>
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
            )}

            <div className={FIELD_PAIR}>
              <div className="flex w-full flex-col gap-y-1">
                <FieldLabel path="trikot_farbe">Trikotfarbe</FieldLabel>
                <TrikotFarbeSelect
                  value={trikotFarbe}
                  onChange={(next) => {
                    onTrikotFarbeChange(next);
                    onValidateTrikotSelection(["trikot_farbe"], { trikot_farbe: next });
                  }}
                  withOwnLabel={false}
                />
              </div>
            </div>

            {/* Why the row is locked is the swap control's to say: the lock is one condition where
                the swap grades four, so a second sentence here could only disagree with it. */}
            {gruppeLock.locked && self !== null && (
              <GruppenTauschControl
                saisonId={saison.saisonId}
                saisonStatus={saison.saisonStatus}
                swap={swap}
                self={self}
              />
            )}
          </>
        ) : saison.saisonStatus === "future" && !isRetired ? (
          <div className="flex w-full flex-col gap-y-4">
            <InlineBanners
              banners={banners}
              spot="saison-eintritt"
            />
            <div className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,15rem)_auto]">
              <GruppeSelect
                value={gruppe}
                onChange={(next) => {
                  // Retracted on the pick, not on the next attempt: the message is about the group
                  // that was refused, and it stops describing the picker the moment that one moves.
                  setEntryGruppeError(null);
                  onGruppeChange(next);
                }}
                offer={gruppeOffer}
                error={entryGruppeError ?? undefined}
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
          // No entry affordance where the junction write refuses one whatever the admin picks: a
          // season past planning (`REQ-ENTER-001`), and a club that has left the league
          // (`REQ-ENTER-005`). A closure over every group is a banner, never a greyed picker.
          <InlineBanners
            banners={banners}
            spot="saison-kein-eintritt"
          />
        )}
      </div>
    </section>
  );
}
