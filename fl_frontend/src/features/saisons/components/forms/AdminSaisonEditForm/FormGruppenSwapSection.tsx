"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { swapGruppenAction } from "@/features/saisons/actions";
import { findSwapPartnerRefusal } from "@/features/saisons/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { RefusableSelect } from "@/shared/components/ui/RefusableSelect";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";

import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "@/features/saisons/types";
import type { SwapPartnerRefusal } from "@/features/saisons/utils";
import type { RefusableOption } from "@/shared/components/ui/RefusableSelect";

/** The pair's accessible name, and the sentence the disabled button points at. Both render once here. */
const PAIR_LABEL_ID = "gruppentausch-paar";
const BUTTON_HINT_ID = "gruppentausch-hinweis";

/** This panel's wording for each refusal `findSwapPartnerRefusal` returns, short enough to sit in a row. */
const PARTNER_REFUSAL_LABEL: Record<SwapPartnerRefusal, string> = {
  self: "schon gewählt",
  sameGruppe: "gleiche Gruppe",
  played: "hat schon gespielt",
  spieltagClash: "zweimal am Spieltag",
};

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
  const { isConfirming, isPending: isSwapping, press, cancel } = useTwoPressConfirm();
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

  /** The season's clubs as one picker offers them, refused by whichever map that side reads. */
  const optionsFrom = (refusals: ReadonlyMap<string, string>): RefusableOption[] =>
    swap.teams.map((team) => ({
      id: team.id,
      name: team.name,
      meta: `Gruppe ${team.gruppe}`,
      refusal: refusals.get(team.id) ?? null,
    }));

  const firstOptions = optionsFrom(unpickable);
  const secondOptions = optionsFrom(unpickableForSecond);

  const handleFirstChange = (id: string) => {
    const team = swap.teams.find((candidate) => candidate.id === id);
    if (team === undefined) return;

    setFirst(team);
    cancel();
    // Cleared rather than kept: a disabled row left selected is a pair the button would send and the
    // endpoint would refuse.
    if (second && findSwapPartnerRefusal(team, second) !== null) setSecond(null);
  };

  const handleSecondChange = (id: string) => {
    const team = swap.teams.find((candidate) => candidate.id === id);
    if (team === undefined) return;

    setSecond(team);
    cancel();
  };

  const handleSwap = () => {
    // Ahead of `press`, so a half-made pair neither arms nor writes. Both are `const`, which is what
    // carries the narrowing into the closure below.
    if (first === null || second === null) return;

    press(async () => {
      const res = await swapGruppenAction({ saison_id: saisonId, team1_id: first.id, team2_id: second.id });

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
          <Hint
            mode="reveal"
            label="Hinweis zum Gruppentausch"
            body={{
              lead: "Zwei Teams tauschen ihre Gruppen.",
              points: [
                { term: "Jede Gruppe", text: "behält ihre Größe." },
                { term: "Die angesetzten Spiele", text: "tauschen mit, samt Gegner, Termin und Ort." },
                { term: "Spiele der KO-Runde", text: "bleiben, wo sie sind." },
                { text: "Verschiebe eines der Spiele, wenn ein Team sonst zweimal an einem Spieltag stünde." },
              ],
            }}
          />
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
              Wähle die beiden Teams, die ihre Gruppen tauschen sollen.
            </p>

            {/* One group rather than two fields: the exchange is one decision over two operands.
                `items-end` rather than a margin — both pickers end in the same trigger height, so
                aligning the bottoms holds the chip on their line. */}
            <div
              role="group"
              aria-labelledby={PAIR_LABEL_ID}
              className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <RefusableSelect
                label="Team"
                placeholder="Team wählen"
                value={firstOptions.find((option) => option.id === first?.id) ?? null}
                options={firstOptions}
                onChange={handleFirstChange}
                isDisabled={isSwapping}
              />
              <SwapConnective
                first={first}
                second={second}
              />
              <RefusableSelect
                label="Tauscht Gruppen mit"
                placeholder="Team wählen"
                value={secondOptions.find((option) => option.id === second?.id) ?? null}
                options={secondOptions}
                onChange={handleSecondChange}
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

            {isConfirming && first !== null && second !== null && (
              <ConfirmReveal>
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  Der Tausch gilt sofort und ist auf jeder Tabelle dieser Saison sichtbar. Rückgängig machst Du ihn, indem Du dieselben beiden
                  Teams noch einmal tauschst.
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
                  aria-describedby={!isSwapping && isMissingAPick ? BUTTON_HINT_ID : undefined}
                  isDisabled={isSwapping || isMissingAPick}
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
              {/* Adjacent to the control it describes, and pointed at by `aria-describedby` — the
                  treatment `FormErgebnisSection` established for a control disabled for a reason the
                  page already shows. */}
              {!isSwapping && isMissingAPick && (
                <Hint
                  mode="inline"
                  describes={BUTTON_HINT_ID}
                  text={missingPickHint}
                />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
