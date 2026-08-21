"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft } from "@gravity-ui/icons";

import { Button, Label, ListBox, Select } from "@heroui/react";

import { swapGruppenAction } from "@/features/saisons/actions";
import { findSwapPartnerRefusal } from "@/features/saisons/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { appToast } from "@/shared/utils/appToast";

import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "@/features/saisons/types";
import type { SwapPartnerRefusal } from "@/features/saisons/utils";
import type { Key } from "@heroui/react";

/** The pair's accessible name, and the sentence the disabled button points at. Both render once here. */
const PAIR_LABEL_ID = "gruppentausch-paar";
const BUTTON_HINT_ID = "gruppentausch-hinweis";

/** This panel's wording for each refusal `findSwapPartnerRefusal` returns, short enough to sit in a row. */
const PARTNER_REFUSAL_LABEL: Record<SwapPartnerRefusal, string> = {
  self: "bereits gewählt",
  sameGruppe: "gleiche Gruppe",
  played: "hat schon gespielt",
  spieltagClash: "zweimal am Spieltag",
};

/**
 * One side of the swap. An `unpickable` club stays VISIBLE and disabled rather than disappearing,
 * which is `GruppeSelect`'s rule for a full group: an admin should see why, not wonder where it went.
 */
function SwapTeamSelect({
  label,
  value,
  onChange,
  teams,
  unpickable,
  isDisabled,
}: {
  label: string;
  value: SaisonSwapTeam | null;
  onChange: (team: SaisonSwapTeam) => void;
  teams: readonly SaisonSwapTeam[];
  /** Club ids this side must not take, with the reason to show beside each. */
  unpickable: ReadonlyMap<string, string>;
  isDisabled: boolean;
}) {
  const handleChange = (key: Key | null) => {
    const picked = teams.find((team) => team.id === key?.toString());
    if (picked) onChange(picked);
  };

  return (
    <Select
      aria-label={label}
      value={value?.id ?? undefined}
      onChange={handleChange}
      isDisabled={isDisabled}
      className="w-full">
      {/* HeroUI's own `Label`, not a bare span: it wires `for`/`id` onto the trigger, which an
          `aria-label` alone leaves unlabelled for anything reading the DOM rather than the a11y tree. */}
      <Label className={FIELD_LABEL}>{label}</Label>
      <Select.Trigger className={`${FIELD_TRIGGER} mt-1.5 w-full justify-between`}>
        {/* From the prop rather than `Select.Value`: the collection can lag a render behind and would
            show HeroUI's English placeholder — `GruppeSelect`'s reason, and `SaisonSelector`'s. */}
        <span className={value ? "" : "text-foreground-muted"}>{value ? `${value.name} (Gruppe ${value.gruppe})` : "Team wählen"}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-72 overflow-y-auto p-1.5`}>
        <ListBox aria-label={label}>
          {teams.map((team) => {
            const reason = unpickable.get(team.id);
            return (
              <ListBox.Item
                key={team.id}
                id={team.id}
                textValue={team.name}
                isDisabled={reason !== undefined}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40">
                <span className="min-w-0 truncate">{team.name}</span>
                <span className="fluid-xs text-foreground-muted shrink-0 font-semibold">{reason ?? `Gruppe ${team.gruppe}`}</span>
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/**
 * **What makes the pair read as one operation** rather than three controls a reader assembles.
 * `aria-hidden`, because it restates the two triggers and the callout below them.
 */
function SwapConnective({ first, second }: { first: SaisonSwapTeam | null; second: SaisonSwapTeam | null }) {
  return (
    <div
      aria-hidden="true"
      className="bg-muted text-foreground-muted fluid-xs flex h-10 shrink-0 items-center justify-center gap-x-1.5 justify-self-center rounded-full px-3 font-bold">
      {/* Vertical between two stacked pickers, horizontal once the grid puts them side by side. */}
      <ArrowRightArrowLeft
        className="size-4 shrink-0 rotate-90 sm:rotate-0"
        width={16}
        height={16}
      />
      {first !== null && second !== null && (
        <span>
          {first.gruppe} ⇄ {second.gruppe}
        </span>
      )}
    </div>
  );
}

/**
 * Two clubs of this season exchange groups in one write. **A confirmation step rather than an undo
 * offer**: the swap is its own inverse, so the useful protection is the sentence before it.
 */
export function FormGruppenSwapSection({
  saisonId,
  swap,
  isFinishedSaison,
}: {
  saisonId: string;
  swap: SaisonGruppenSwapContext;
  /** `REQ-SWAP-003`: a `past` season's groups are frozen, so the panel explains instead of offering. */
  isFinishedSaison: boolean;
}) {
  const router = useRouter();
  const panel = formPanel();
  const [isSwapping, startSwapping] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [first, setFirst] = useState<SaisonSwapTeam | null>(null);
  const [second, setSecond] = useState<SaisonSwapTeam | null>(null);

  const isClosed = swap.playedKnockoutSpiele > 0;

  // A club that has played inside its group cannot leave it (`REQ-SWAP-004`), so counting it here
  // would open the panel on a pair the endpoint 409s.
  const swappable = swap.teams.filter((team) => team.gespielteGruppenSpiele === 0);
  const hasTwoGruppen = new Set(swap.teams.map((team) => team.gruppe)).size >= 2;
  const hasTwoSwappableGruppen = new Set(swappable.map((team) => team.gruppe)).size >= 2;

  /**
   * `REQ-SWAP-004` in the form, for EITHER picker: a club with a played Gruppenphase fixture is in a
   * round robin it can no longer leave, whichever side of the exchange it is offered as.
   */
  const unpickable = new Map<string, string>();
  for (const team of swap.teams) {
    if (team.gespielteGruppenSpiele > 0) unpickable.set(team.id, PARTNER_REFUSAL_LABEL.played);
  }

  /**
   * Rebuilt against `first` rather than computed once: a Spieltag clash is a property of the PAIR
   * (`REQ-SWAP-005`), so no club is unpickable for the second picker on its own account.
   */
  const unpickableForSecond = new Map(unpickable);
  if (first) {
    for (const team of swap.teams) {
      const refusal = findSwapPartnerRefusal(first, team);
      if (refusal !== null) unpickableForSecond.set(team.id, PARTNER_REFUSAL_LABEL[refusal]);
    }
  }

  const handleFirstChange = (team: SaisonSwapTeam) => {
    setFirst(team);
    setIsConfirming(false);
    // Cleared rather than kept: a disabled row left selected is a pair the button would send and the
    // endpoint would refuse.
    if (second && findSwapPartnerRefusal(team, second) !== null) setSecond(null);
  };

  const handleSecondChange = (team: SaisonSwapTeam) => {
    setSecond(team);
    setIsConfirming(false);
  };

  const handleSwap = () => {
    if (first === null || second === null) return;

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startSwapping(async () => {
      const res = await swapGruppenAction({ saison_id: saisonId, team1_id: first.id, team2_id: second.id });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Tausch fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      appToast.success("Gruppen getauscht", { description: res.message });
      setFirst(null);
      setSecond(null);
      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // whose pickers now have to show the groups the swap produced.
      router.refresh();
    });
  };

  // Rendered only while the button is disabled for a reason a reader can act on. A swap in flight
  // names nothing: the label already says so.
  const missingPickHint = first === null ? "Wähle zwei Teams aus zwei verschiedenen Gruppen." : "Wähle noch das zweite Team.";
  const isMissingAPick = first === null || second === null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Gruppentausch
          <InfoHint label="Hinweis zum Gruppentausch">
            <p>Zwei Teams tauschen ihre Gruppen. Das geschieht in einem Schritt, nicht in zwei.</p>
            <ul>
              <li>
                Jede Gruppe behält ihre <strong>Größe</strong>. Die angesetzten Spiele tauschen mit: Jedes Team übernimmt Gegner, Termine und
                Orte des anderen.
              </li>
              <li>Die Tabellen beider Gruppen sehen ab sofort anders aus.</li>
              <li>
                Sobald eines der beiden in seiner Gruppe <strong>gespielt</strong> hat, geht es nicht mehr: Eine Gruppe ist ein Rundenturnier,
                in dem jedes Team gegen jedes andere seiner Gruppe spielt.
              </li>
              <li>
                Spiele der KO-Runde tauschen <strong>nicht</strong> mit. Stünde ein Team dadurch zweimal an einem Spieltag, ist das Paar nicht
                wählbar. Verschiebe dann eines der beiden Spiele.
              </li>
              <li>
                Ein <strong>einzelner</strong> Wechsel bleibt gesperrt, hier wie auf der Teamseite. Dort lässt sich derselbe Tausch mit dem
                geöffneten Team als einer Seite starten; hier wählst Du beide Seiten selbst.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {isFinishedSaison ? (
          <Callout
            severity="info"
            title="Die Saison ist abgeschlossen">
            Eine abgeschlossene Saison wird nicht mehr verändert. Ihre Tabellen bleiben so, wie sie am Saisonende standen.
          </Callout>
        ) : isClosed ? (
          <Callout
            severity="info"
            title="Die KO-Runde hat begonnen">
            {swap.playedKnockoutSpiele === 1
              ? "Ein Spiel der KO-Runde wurde schon gespielt oder abgesagt."
              : `${String(swap.playedKnockoutSpiele)} Spiele der KO-Runde wurden schon gespielt oder abgesagt.`}{" "}
            Die Setzung ist aus diesen Gruppen entstanden, deshalb lässt sich jetzt keine Gruppe mehr tauschen.
          </Callout>
        ) : !hasTwoGruppen ? (
          <Callout
            severity="info"
            title="Noch nichts zu tauschen">
            Für einen Tausch müssen Teams in mindestens zwei verschiedenen Gruppen stehen. Nimm die Teams über die Teamseite in die Saison auf.
          </Callout>
        ) : !hasTwoSwappableGruppen ? (
          <Callout
            severity="info"
            title="Die Gruppenphase ist zu weit">
            Tauschen können nur Teams, die in ihrer Gruppe noch kein Spiel gespielt oder abgesagt bekommen haben, und die gibt es nicht mehr in
            zwei verschiedenen Gruppen. Eine Gruppe ist ein Rundenturnier: Wer darin einmal gespielt hat, gehört dorthin.
          </Callout>
        ) : (
          <>
            <p
              id={PAIR_LABEL_ID}
              className="fluid-sm text-foreground font-medium">
              Wähle die beiden Teams, die ihre Gruppen tauschen sollen. Beide müssen in dieser Saison stehen, in zwei verschiedenen Gruppen, und
              dürfen in ihrer Gruppe noch nicht gespielt haben.
            </p>

            {/* One group rather than two fields: the exchange is one decision over two operands.
                `items-end` rather than a margin — both pickers end in the same trigger height, so
                aligning the bottoms holds the chip on their line. */}
            <div
              role="group"
              aria-labelledby={PAIR_LABEL_ID}
              className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <SwapTeamSelect
                label="Team"
                value={first}
                onChange={handleFirstChange}
                teams={swap.teams}
                unpickable={unpickable}
                isDisabled={isSwapping}
              />
              <SwapConnective
                first={first}
                second={second}
              />
              <SwapTeamSelect
                label="Tauscht Gruppen mit"
                value={second}
                onChange={handleSecondChange}
                teams={swap.teams}
                unpickable={unpickableForSecond}
                isDisabled={isSwapping || first === null}
              />
            </div>

            {/* The outcome spelled out before it is caused, which is the whole value of the confirm
                step: the two group letters are what an admin checks, and they are what a mis-click
                gets wrong. */}
            {first !== null && second !== null && (
              <Callout
                severity="warning"
                title="Das passiert beim Tausch">
                <strong>{first.name}</strong> steht danach in Gruppe {second.gruppe}, <strong>{second.name}</strong> in Gruppe {first.gruppe}.
                Beide übernehmen dabei die angesetzten Spiele des anderen, mit Gegner, Termin und Ort. Die Tabellen beider Gruppen ändern sich
                sofort.
              </Callout>
            )}

            {/* Escalated in place, the rollover's shape: without `role="alert"` the only signal is the
                button label quietly changing. */}
            {isConfirming && first !== null && second !== null && (
              <div
                role="alert"
                className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm`}>
                <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  Der Tausch gilt sofort und ist auf jeder Tabelle dieser Saison sichtbar. Rückgängig machst Du ihn, indem Du dieselben beiden
                  Teams noch einmal tauschst.
                </p>
              </div>
            )}

            <div className="flex w-full flex-col gap-y-1.5">
              <div className="flex w-full flex-row flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  aria-describedby={!isSwapping && isMissingAPick ? BUTTON_HINT_ID : undefined}
                  isDisabled={isSwapping || isMissingAPick}
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
              {/* Adjacent to the control it describes, and pointed at by `aria-describedby` — the
                  treatment `FormErgebnisSection` established for a control disabled for a reason the
                  page already shows. */}
              {!isSwapping && isMissingAPick && (
                <p
                  id={BUTTON_HINT_ID}
                  className="fluid-xxs text-foreground-muted leading-normal font-medium">
                  {missingPickHint}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
