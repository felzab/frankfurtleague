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
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FIELD_PAIR, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { appToast } from "@/shared/utils/appToast";

import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "@/features/saisons/types";
import type { SwapPartnerRefusal } from "@/features/saisons/utils";
import type { FLGruppenNames } from "@/features/teams/schemas";
import type { GruppeOffer, TeamGruppeLock, TeamSaisonContext } from "@/features/teams/types";
import type { Key } from "@heroui/react";
import type { TeamBanner } from "./banners";

/** The sentence the disabled swap button is described by. This control renders at most once per page. */
const SWAP_BUTTON_HINT_ID = "gruppentausch-team-hinweis";

/**
 * Different words from the season panel's for the same codes, deliberately: here one side is fixed
 * and named at the top of the page, so a row says what is true of the club in it, not of the pair.
 */
const PARTNER_REFUSAL_LABEL: Record<SwapPartnerRefusal, string> = {
  self: "diese Mannschaft",
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
  const [isSwapping, startSwapping] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [partner, setPartner] = useState<SaisonSwapTeam | null>(null);

  // Graded by the SHARED `findSwapPartnerRefusal`, so a club this picker accepts is one the endpoint
  // accepts. Visible and disabled rather than absent, as `GruppeSelect` does.
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
      // Re-renders the page the admin is still standing on, whose locked group row has to show the
      // group the swap produced.
      router.refresh();
    });
  };

  return (
    <div className="border-border flex w-full flex-col gap-y-3 border-t pt-5">
      {/* A sub-group, not a panel of its own: it edits the row above it, and a second bordered box
          for one picker would read as a second subject. */}
      <p className={FORM_SECTION_HEADING}>Gruppe tauschen</p>

      {/* The whole-control closures, in the endpoint's own order. Each refuses every pair alike, so
          none of them is a row. */}
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
          Wer in einer Gruppe schon gespielt hat, bleibt in ihr.
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
            <strong>{self.name}</strong> steht in Gruppe {self.gruppe}. Wähle die Mannschaft, mit der die Gruppe getauscht wird. Beide wechseln
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
                {/* From the prop, not `Select.Value` — the collection can lag a render behind and
                would then show HeroUI's English placeholder. */}
                <span className={partner ? "" : "text-foreground-muted"}>
                  {partner ? `${partner.name} (Gruppe ${partner.gruppe})` : "Mannschaft wählen"}
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

            {/* The two questions this picker raises — why a row is grey, and why an expected club is
            missing — answered where it raises them. */}
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
              Beide übernehmen dabei die angesetzten Spiele der anderen, mit Gegner, Termin und Ort. Die Tabellen beider Gruppen ändern sich
              sofort.
            </Callout>
          )}

          {/* Escalated in place: without `role="alert"` the only signal is the button label quietly
          changing. */}
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
            {/* Adjacent to the control it describes and pointed at by `aria-describedby`, the app's
            treatment for a control disabled for a reason already on screen. */}
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
 * **The swap control appears only while the group is locked**, because that is the state it answers:
 * with the picker still free, two routes to one outcome would ask the admin to choose between them.
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
  banners: readonly TeamBanner[];
  /** The season's groups with their fill state (`buildGruppeOffer`) — what the pickers may offer. */
  gruppeOffer: readonly GruppeOffer[];
  isMember: boolean;
  gruppe: FLGruppenNames | null;
  onGruppeChange: (next: FLGruppenNames) => void;
  onValidateSelection: (paths: readonly string[], selected: { gruppe: FLGruppenNames }) => void;
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
        appToast.success(res.message ?? "Mannschaft aufgenommen!");
        return;
      }
      // Suppressed where the picker carries the message, so a refusal about the chosen group is not
      // also said in a toast that names no field.
      if (gruppeError === null) {
        appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
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
          <InfoHint label="Hinweis zur Saison-Zugehörigkeit">
            <p>Dieser Bereich gilt für die Saison, die im Seitenmenü ausgewählt ist.</p>
            <ul>
              <li>
                Eine <strong>andere Saison</strong> wählst Du im Seitenmenü aus.
              </li>
              <li>
                Der <strong>Austritt</strong> unten ist der einzige Weg aus einer Saison — als Disqualifikation oder als Rückzug.
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
                <FieldLabel path="gruppe">Gruppe</FieldLabel>
                <div className="border-border bg-muted/40 text-foreground fluid-sm flex h-10 w-full items-center gap-x-2 rounded-lg border px-3 font-bold sm:max-w-60">
                  <LockFill className="text-foreground-muted size-3.5 shrink-0" />
                  {gruppe ? `Gruppe ${gruppe}` : "Keine Gruppe"}
                </div>
              </div>

              {/* Why the row is locked is the swap control's to say: the lock is one condition where
                  the swap grades four, so a second sentence here could only disagree with it. */}
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
          // No entry affordance outside a planned season: a season's field is settled before it
          // starts, and the junction write refuses the same (`REQ-ENTER-001`).
          <InlineBanners
            banners={banners}
            spot="saison-gesperrt"
          />
        )}
      </div>
    </section>
  );
}
