"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight } from "@gravity-ui/icons";

import { Button, Label, ListBox, Select } from "@heroui/react";

import { replaceSaisonTeamAction } from "@/features/teams/actions";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { appToast } from "@/shared/utils/appToast";

import { describePlatz, describeUebernommeneSpiele } from "./replacementOffer";

import type { SaisonReplacementContext } from "@/features/saisons/types";
import type { Key } from "@heroui/react";

/** The pair's accessible name, and the sentence the disabled button points at. Both render once here. */
const PAIR_LABEL_ID = "teamwechsel-paar";
const BUTTON_HINT_ID = "teamwechsel-hinweis";

/** One row of either picker. `refusal` is why it cannot be taken, rendered beside its name. */
type PickerOption = { id: string; name: string; meta: string | null; refusal: string | null };

/**
 * One side of the replacement. A refused option stays VISIBLE and disabled rather than disappearing,
 * which is the swap's rule and `GruppeSelect`'s: an admin should see why, not wonder where it went.
 */
function TeamPicker({
  label,
  placeholder,
  value,
  options,
  onChange,
  isDisabled,
}: {
  label: string;
  placeholder: string;
  value: PickerOption | null;
  options: readonly PickerOption[];
  onChange: (id: string) => void;
  isDisabled: boolean;
}) {
  const handleChange = (key: Key | null) => {
    const picked = options.find((option) => option.id === key?.toString());
    if (picked) onChange(picked.id);
  };

  return (
    <Select
      aria-label={label}
      value={value?.id ?? undefined}
      onChange={handleChange}
      isDisabled={isDisabled}
      className="w-full">
      {/* HeroUI's own `Label`, for the reason the swap's picker gives: an `aria-label` alone leaves
          the trigger unlabelled for anything reading the DOM rather than the a11y tree. */}
      <Label className={FIELD_LABEL}>{label}</Label>
      <Select.Trigger className={`${FIELD_TRIGGER} mt-1.5 w-full justify-between`}>
        {/* From the prop rather than `Select.Value`, which can lag a render behind and would show
            HeroUI's English placeholder — `GruppeSelect`'s reason, and `SaisonSelector`'s. */}
        <span className={value ? "" : "text-foreground-muted"}>
          {value === null ? placeholder : value.meta === null ? value.name : `${value.name} (${value.meta})`}
        </span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-72 overflow-y-auto p-1.5`}>
        <ListBox aria-label={label}>
          {options.map((option) => {
            const note = option.refusal ?? option.meta;
            return (
              <ListBox.Item
                key={option.id}
                id={option.id}
                textValue={option.name}
                isDisabled={option.refusal !== null}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40">
                <span className="min-w-0 truncate">{option.name}</span>
                {note !== null && <span className="fluid-xs text-foreground-muted shrink-0 font-semibold">{note}</span>}
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/**
 * On `POST /teams/{team_id}/saisons/{saison_id}/replace`: a season's junction row, and every fixture
 * on it, change hands. **A confirmation and no undo offer** — the schedule survives, the cleared
 * Austritt and the retired squad rows do not.
 */
export function FormTeamErsatzSection({
  saisonId,
  ersatz,
  isFinishedSaison,
}: {
  saisonId: string;
  ersatz: SaisonReplacementContext;
  /** `REQ-REPLACE-001`: a finished season's fixtures record who played, so the panel explains instead of offering. */
  isFinishedSaison: boolean;
}) {
  const router = useRouter();
  const [isReplacing, startReplacing] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [outgoingId, setOutgoingId] = useState<string | null>(null);
  const [incomingId, setIncomingId] = useState<string | null>(null);

  const outgoing = ersatz.rows.find((row) => row.teamId === outgoingId) ?? null;
  const incoming = ersatz.candidates.find((candidate) => candidate.id === incomingId) ?? null;

  // `REQ-REPLACE-002` in the form: a fixture carrying a record would be credited to the arriving
  // club, so the row it stands on cannot be handed over.
  const outgoingOptions: PickerOption[] = ersatz.rows.map((row) => ({
    id: row.teamId,
    name: row.name,
    meta: row.gruppe === null ? "ohne Teamdaten" : `Gruppe ${row.gruppe}`,
    refusal: row.gespielteSpiele > 0 ? "hat schon gespielt" : null,
  }));

  // The outgoing club holds a row here too, so the first arm is also what keeps one club off both
  // ends of the same wechsel — the second picture behind `REQ-REPLACE-003`.
  const incomingOptions: PickerOption[] = ersatz.candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    meta: null,
    refusal: candidate.isInSaison ? "schon in dieser Saison" : candidate.isStillgelegt ? "stillgelegt" : null,
  }));

  const hasPickableRow = outgoingOptions.some((option) => option.refusal === null);
  const hasPickableCandidate = incomingOptions.some((option) => option.refusal === null);
  const isOffered = !isFinishedSaison && ersatz.rows.length > 0 && hasPickableRow && hasPickableCandidate;

  // The tone grades the act on offer, as the draw's and the rollover's do: nothing a later edit
  // reverses, but only where there is still something to press.
  const panel = formPanel({ tone: isOffered ? "danger" : "neutral" });

  const handleReplace = () => {
    if (outgoing === null || incoming === null) return;

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startReplacing(async () => {
      const res = await replaceSaisonTeamAction({ team_id: outgoing.teamId, saison_id: saisonId, incoming_team_id: incoming.id });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Wechsel fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      appToast.success("Team ersetzt", { description: res.message });
      setOutgoingId(null);
      setIncomingId(null);
      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // whose pickers now have to show the season this write produced.
      router.refresh();
    });
  };

  // Rendered only while the button is disabled for a reason a reader can act on. A write in flight
  // names nothing: the label already says so.
  const missingPickHint = outgoing === null ? "Wähle das ausscheidende und das nachrückende Team." : "Wähle noch das nachrückende Team.";
  const isMissingAPick = outgoing === null || incoming === null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Team ersetzen
          <InfoHint label="Hinweis zum Ersetzen">
            <p>Ein Team gibt seinen Platz in dieser Saison an ein anderes ab. Der Spielplan bleibt dabei stehen.</p>
            <ul>
              <li>
                Das nachrückende Team übernimmt <strong>Gruppe</strong>, Gegner, Termine und Orte des ausscheidenden Teams. Kein Spiel wird
                gelöscht, keines verschoben.
              </li>
              <li>
                Ein eingetragener <strong>Austritt</strong> wird dabei aufgehoben: Der Platz gehört danach dem nachrückenden Team, und das ist
                dabei.
              </li>
              <li>
                Die <strong>Spieler</strong> des ausscheidenden Teams werden für diese Saison stillgelegt. Sie wechseln nicht mit, und ihre
                Anmeldung bleibt bestehen; das nachrückende Team meldet seinen Kader selbst.
              </li>
              <li>
                Sobald das ausscheidende Team in dieser Saison <strong>gespielt</strong> hat, geht es nicht mehr: Ein Ergebnis, Tore, ein
                Abbruch oder ein Nichtantreten würde dem nachrückenden Team zugeschrieben. Trage dann stattdessen einen Austritt ein.
              </li>
              <li>
                Steht in der Saison ein Platz, zu dem es <strong>keine Teamdaten</strong> mehr gibt, lässt er sich nur hier vergeben: Ein
                solches Team hat keine eigene Seite.
              </li>
              <li>
                Zurücknehmen lässt sich der Wechsel in der Verwaltung nicht. Der aufgehobene Austritt und die stillgelegten Spieler kommen auch
                dann nicht zurück, wenn Du die beiden Teams anschließend erneut wechselst.
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
            Ihre Spiele halten fest, wer gespielt hat, und ein Wechsel würde das umschreiben. Ersetzen lässt sich ein Team nur in einer
            laufenden oder geplanten Saison.
          </Callout>
        ) : ersatz.rows.length === 0 ? (
          <Callout
            severity="info"
            title="Noch kein Team in dieser Saison">
            Ersetzen lässt sich nur ein Team, das in dieser Saison steht. Nimm die Teams über die Teamseite in die Saison auf.
          </Callout>
        ) : !hasPickableRow ? (
          <Callout
            severity="info"
            title="Die Saison ist zu weit">
            Ersetzen lässt sich nur ein Team, das in dieser Saison noch nicht gespielt hat, und das trifft auf keines mehr zu. Jedes Ergebnis
            gehört dem Team, das es geholt hat. Trage für ein ausscheidendes Team stattdessen einen Austritt ein.
          </Callout>
        ) : !hasPickableCandidate ? (
          <Callout
            severity="info"
            title="Kein Team zum Nachrücken">
            Nachrücken kann nur ein Team, das in dieser Saison noch nicht dabei und nicht stillgelegt ist. Zurzeit gibt es keines. Lege über die
            Teamseite ein neues an oder reaktiviere ein stillgelegtes.
          </Callout>
        ) : (
          <>
            <p
              id={PAIR_LABEL_ID}
              className="fluid-sm text-foreground font-medium">
              Wähle das Team, das ausscheidet, und das Team, das seinen Platz übernimmt. Der Spielplan dieser Saison bleibt dabei stehen: Das
              nachrückende Team spielt die Spiele, die schon angesetzt sind.
            </p>

            {/* One group rather than two fields, the swap's reason: the handover is one decision over
                two operands. `items-end` holds the arrow on the line the two triggers end at. */}
            <div
              role="group"
              aria-labelledby={PAIR_LABEL_ID}
              className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <TeamPicker
                label="Ausscheidendes Team"
                placeholder="Team wählen"
                value={outgoingOptions.find((option) => option.id === outgoingId) ?? null}
                options={outgoingOptions}
                onChange={(id) => {
                  setOutgoingId(id);
                  setIsConfirming(false);
                }}
                isDisabled={isReplacing}
              />
              {/* `aria-hidden`, because it restates the two triggers and the callout below them. */}
              <div
                aria-hidden="true"
                className="bg-muted text-foreground-muted flex h-10 shrink-0 items-center justify-center justify-self-center rounded-full px-3">
                {/* Downwards between two stacked pickers, rightwards once the grid puts them side by side. */}
                <ArrowRight
                  className="size-4 shrink-0 rotate-90 sm:rotate-0"
                  width={16}
                  height={16}
                />
              </div>
              <TeamPicker
                label="Nachrückendes Team"
                placeholder="Team wählen"
                value={incomingOptions.find((option) => option.id === incomingId) ?? null}
                options={incomingOptions}
                onChange={(id) => {
                  setIncomingId(id);
                  setIsConfirming(false);
                }}
                isDisabled={isReplacing || outgoing === null}
              />
            </div>

            {outgoing?.isVerwaist === true && (
              <Callout
                severity="info"
                title="Zu diesem Team gibt es keine Daten mehr">
                Der Platz steht in der Saison, das Team dahinter ist aber nicht mehr angelegt: Es hat keine eigene Seite, und seine Gruppe lässt
                sich hier nicht anzeigen. Der Wechsel gibt den Platz trotzdem weiter — das nachrückende Team steht danach in der Gruppe, die auf
                dem Platz eingetragen ist.
              </Callout>
            )}

            {/* The outcome spelled out before it is caused, which is the whole value of the confirm
                step: the two names and the group are what an admin checks, and what a mis-click gets
                wrong. */}
            {outgoing !== null && incoming !== null && (
              <Callout
                severity="warning"
                title="Das passiert beim Wechsel">
                <strong>{incoming.name}</strong> übernimmt den Platz von <strong>{outgoing.name}</strong> {describePlatz(outgoing.gruppe)}.{" "}
                {describeUebernommeneSpiele(outgoing.spiele)} Die Spieler von {outgoing.name} werden für diese Saison stillgelegt.
              </Callout>
            )}

            {/* Escalated in place, the swap's and the draw's shape: without `role="alert"` the only
                signal is the button label quietly changing. */}
            {isConfirming && outgoing !== null && incoming !== null && (
              <div
                role="alert"
                className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
                <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>

                {/* Inside the alert rather than beside it, the draw's reason: this IS what the press is
                    judged on, and a region announced without it asks for agreement to nothing. */}
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING}>Was {incoming.name} übernimmt</h3>
                  <dl className="flex w-full flex-col gap-y-1">
                    <div className="flex flex-row items-baseline justify-between gap-x-3">
                      <dt className="fluid-xxs text-foreground-muted font-bold">Platz in der Saison</dt>
                      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">
                        {outgoing.gruppe === null ? "Nicht bekannt" : `Gruppe ${outgoing.gruppe}`}
                      </dd>
                    </div>
                    <div className="flex flex-row items-baseline justify-between gap-x-3">
                      <dt className="fluid-xxs text-foreground-muted font-bold">Angesetzte Spiele</dt>
                      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">
                        {outgoing.spiele === 0 ? "Keine" : outgoing.spiele === 1 ? "ein Spiel" : `${String(outgoing.spiele)} Spiele`}
                      </dd>
                    </div>
                    <div className="flex flex-row items-baseline justify-between gap-x-3">
                      <dt className="fluid-xxs text-foreground-muted font-bold">Austritt von {outgoing.name}</dt>
                      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">
                        {outgoing.hasAustritt ? "wird aufgehoben" : "keiner eingetragen"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  Der Wechsel gilt sofort und ist auf jeder Tabelle und jedem Spielplan dieser Saison zu sehen. Zurücknehmen lässt er sich in
                  der Verwaltung nicht: Die Spieler von {outgoing.name} bleiben für diese Saison stillgelegt, auch wenn Du die beiden Teams
                  anschließend erneut wechselst.
                </p>
              </div>
            )}

            <div className="flex w-full flex-col gap-y-1.5">
              <div className="flex w-full flex-row flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  aria-describedby={!isReplacing && isMissingAPick ? BUTTON_HINT_ID : undefined}
                  isDisabled={isReplacing || isMissingAPick}
                  onPress={handleReplace}
                  className={`${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`}>
                  {!isConfirming && (
                    <ArrowRight
                      aria-hidden="true"
                      width={18}
                      height={18}
                    />
                  )}
                  {isReplacing ? "Wird ersetzt..." : isConfirming ? "Ja, Team ersetzen" : "Team ersetzen"}
                </Button>
                {isConfirming && (
                  <Button
                    type="button"
                    variant="secondary"
                    isDisabled={isReplacing}
                    onPress={() => setIsConfirming(false)}
                    className={formButton({ intent: "cancel" })}>
                    Abbrechen
                  </Button>
                )}
              </div>
              {/* Adjacent to the control it describes, and pointed at by `aria-describedby` — the swap's
                  treatment for a control disabled for a reason the page already shows. */}
              {!isReplacing && isMissingAPick && (
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
