"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft } from "@gravity-ui/icons";

import { Button, Label, ListBox, Select } from "@heroui/react";

import { swapGruppenAction } from "@/features/saisons/actions";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { appToast } from "@/shared/utils/appToast";

import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "@/features/saisons/types";
import type { Key } from "@heroui/react";

/**
 * One side of the swap: a club picker listing every club of the season with the group it holds.
 *
 * A picked control, so there is nothing to judge on blur (ADR-0040) — a selection is complete the
 * moment it is made. `unpickable` names the clubs this side may not take, and they stay VISIBLE and
 * disabled rather than disappearing, which is `GruppeSelect`'s rule for a full group: an admin should
 * see why a club cannot be chosen instead of wondering where it went.
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
        <span className={value ? "" : "text-foreground-muted"}>{value ? `${value.name} — Gruppe ${value.gruppe}` : "Mannschaft wählen"}</span>
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
                className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200 data-disabled:cursor-not-allowed data-disabled:opacity-40">
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
 * The group swap: two clubs of this season exchange groups, in one write (ADR-0062).
 *
 * **The one mid-season group change that is defensible.** A group decides which table counts a club's
 * results and which bracket slot its placing seeds (ADR-0035), so moving a single club falsifies both —
 * which is why the club editor locks its Gruppe picker the moment the season is under way and the club
 * has a fixture. Two clubs exchanging keeps each group's size and leaves every drawn fixture facing the
 * opponents it was drawn against, and that lock's own message names this as the case that would be
 * defensible.
 *
 * **On the season and not on the club.** The club editor addresses one club, so a two-club operation
 * would sit there as an act on somebody who is not the subject of the page.
 *
 * **A control rather than a field.** It writes the moment it is confirmed and never joins the save bar,
 * which is the shape the rollover takes above it and the retire controls take on the other editors.
 *
 * **A confirmation step rather than an undo offer.** The swap is its own inverse — running it again on
 * the same pair restores the season — so the useful protection is the sentence before it rather than a
 * fifteen-second window and a route handler afterwards (ADR-0049 keeps that machinery for the editors
 * whose save it belongs to).
 *
 * **Once the knockout has a result the control refuses rather than warns** (`REQ-SWAP-002`). The
 * standings have been consumed by the seeding, so there is no reading under which the swap is still
 * defensible — and the endpoint refuses the same thing and stays the authority (ADR-0038).
 */
export function FormGruppenSwapSection({ saisonId, swap }: { saisonId: string; swap: SaisonGruppenSwapContext }) {
  const router = useRouter();
  const panel = formPanel();
  const [isSwapping, startSwapping] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [first, setFirst] = useState<SaisonSwapTeam | null>(null);
  const [second, setSecond] = useState<SaisonSwapTeam | null>(null);

  const isClosed = swap.playedKnockoutSpiele > 0;
  // Two groups have to be occupied for an exchange to exist at all — a season whose clubs all stand in
  // one group has nothing to swap, which is the ordinary state of a season being set up.
  const occupiedGruppen = new Set(swap.teams.map((team) => team.gruppe));
  const hasTwoGruppen = occupiedGruppen.size >= 2;

  /**
   * What the SECOND picker may not take, keyed by club id with the reason shown beside it.
   *
   * Both exclusions are `REQ-SWAP-001` said in the form (ADR-0038): a club cannot exchange groups with
   * itself, and two clubs of one group exchange nothing. Offering either would be offering a request
   * the write path answers with a 409.
   */
  const unpickableForSecond = new Map<string, string>();
  if (first) {
    for (const team of swap.teams) {
      if (team.id === first.id) unpickableForSecond.set(team.id, "bereits gewählt");
      else if (team.gruppe === first.gruppe) unpickableForSecond.set(team.id, "gleiche Gruppe");
    }
  }

  const handleFirstChange = (team: SaisonSwapTeam) => {
    setFirst(team);
    setIsConfirming(false);
    // Cleared rather than kept: the new first pick can make the standing second one illegal, and a
    // disabled row left selected is a pair the button would send and the endpoint would refuse.
    if (second && (second.id === team.id || second.gruppe === team.gruppe)) setSecond(null);
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
      // The action's own invalidation reaches the caches; this is what re-renders the page the admin is
      // still standing on, whose pickers now have to show the groups the swap produced.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Gruppentausch
          <InfoHint label="Hinweis zum Gruppentausch">
            <p>Zwei Mannschaften tauschen ihre Gruppen — in einem Schritt, nicht in zwei.</p>
            <ul>
              <li>
                Jede Gruppe behält ihre <strong>Größe</strong>, und angesetzte Spiele behalten ihre Gegner.
              </li>
              <li>Die Tabellen beider Gruppen sehen ab sofort anders aus.</li>
              <li>Ein einzelner Wechsel ist nicht vorgesehen. Dafür ist die Mannschaftsseite zuständig, und dort ist er gesperrt.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {isClosed ? (
          <Callout
            severity="info"
            title="Die KO.-Runde hat begonnen">
            {swap.playedKnockoutSpiele === 1
              ? "Ein Spiel der KO.-Runde hat schon ein Ergebnis."
              : `${String(swap.playedKnockoutSpiele)} Spiele der KO.-Runde haben schon ein Ergebnis.`}{" "}
            Die Setzung ist aus diesen Gruppen entstanden, deshalb lässt sich jetzt keine Gruppe mehr tauschen.
          </Callout>
        ) : !hasTwoGruppen ? (
          <Callout
            severity="info"
            title="Noch nichts zu tauschen">
            Für einen Tausch müssen Mannschaften in mindestens zwei verschiedenen Gruppen stehen. Nimm die Mannschaften über die
            Mannschaftsseite in die Saison auf.
          </Callout>
        ) : (
          <>
            <p className="fluid-sm text-foreground font-medium">
              Wähle die beiden Mannschaften, die ihre Gruppen tauschen sollen. Beide müssen in dieser Saison stehen, in zwei verschiedenen
              Gruppen.
            </p>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <SwapTeamSelect
                label="Erste Mannschaft"
                value={first}
                onChange={handleFirstChange}
                teams={swap.teams}
                unpickable={new Map()}
                isDisabled={isSwapping}
              />
              <SwapTeamSelect
                label="Zweite Mannschaft"
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
                Die Tabellen beider Gruppen ändern sich damit sofort.
              </Callout>
            )}

            {/* Escalated in place, the rollover's shape: without `role="alert"` the only signal is the
                button label quietly changing. */}
            {isConfirming && first !== null && second !== null && (
              <div
                role="alert"
                className="animate-in fade-in slide-in-from-bottom-4 bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm duration-400">
                <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  Der Tausch gilt sofort und ist auf jeder Tabelle dieser Saison sichtbar. Rückgängig machst Du ihn, indem Du dieselben beiden
                  Mannschaften noch einmal tauschst.
                </p>
              </div>
            )}

            <div className="flex w-full flex-row flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                isDisabled={isSwapping || first === null || second === null}
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
          </>
        )}
      </div>
    </section>
  );
}
