"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Envelope } from "@gravity-ui/icons";

import { Switch } from "@heroui/react";

import { postEinladungVersandAction, previewEinladungVersandAction } from "@/features/einladungen/actions";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";

import type { FLEinladungVersandGrund, FLEinladungVersandVorschauZeile } from "@/features/einladungen/schemas";
import type { EinladungVersandErgebnis } from "@/features/einladungen/types";

/** The ruling's own words, copied rather than reworded: a label a visitor navigates by is nobody's here to choose. */
const SENDEN_LABEL = "Links an alle Teams senden";

/** The ruling's words again, under the „Ja, …“ the armed step wears everywhere: „Links“ is a noun and keeps its capital. */
const SENDEN_ARMED = `Ja, ${SENDEN_LABEL}`;

/**
 * **These are ordinary states** of a season being set up, and wording one as a failure would send
 * somebody hunting for a fault nobody has.
 */
const UEBERSPRUNGEN_SATZ: Record<FLEinladungVersandGrund, string> = {
  // The RECORD rather than the route it was entered under: no rule keyed on a club having left
  // reads that route (`fl_frontend/src/features/teams/constants.ts :: AUSTRITT_OPTIONS` holds its
  // German), so naming one here would report a fact nothing judges.
  austritt_eingetragen: "Austritt eingetragen",
  erzeugung_fehlgeschlagen: "Registrierungslink nicht angelegt",
  kein_kontaktblock: "Keine Kontaktdaten hinterlegt",
  keine_bestaetigte_kontaktperson: "Niemand hat die Kontaktdaten bisher selbst bestätigt",
  bereits_gesendet: "Hat den Link schon bekommen",
};

/**
 * What the one failure leaves standing, said in the row rather than in a toast that goes: the team's
 * transaction rolled back whole, so nothing was sent AND the link it already had still opens.
 */
const FEHLGESCHLAGEN_FOLGE = "Der bisherige Link dieses Teams gilt weiter. Ein neuer Versand versucht es noch einmal.";

/** Beside the addresses rather than instead of them: this team is written to AND loses what it holds. */
const ERSETZT_SATZ = "Ersetzt den Link, den dieses Team schon hat";

/** The same fact after the write, which is when somebody may have to tell a team their old link is dead. */
const ERSETZT_VERGANGEN = "Der bisherige Link dieses Teams funktioniert nicht mehr";

/** The addresses a person could still write to by hand, which a withheld one is not. */
const nichtErreicht = (zeile: EinladungVersandErgebnis): readonly string[] =>
  zeile.unerreichbar.filter((adresse) => !zeile.zurueckgehalten.includes(adresse));

/**
 * **No numeral stands before a plural noun**: „An 1 Adressen“ is what a count interpolated into one
 * sentence produces (`docs/frontend/spec.md :: 1.12`).
 */
function zustellSatz(zeile: EinladungVersandErgebnis): string {
  const gesamt = zeile.zugestellt.length + zeile.unerreichbar.length;

  // Ahead of the count, because outside production it is EVERY row: a deployment that sends nothing
  // is not a team the league failed to reach, and grading it as one teaches a reader to ignore red.
  if (gesamt > 0 && zeile.zurueckgehalten.length === gesamt) return ZURUECKGEHALTEN;
  if (zeile.zugestellt.length === 0) return "Nicht zugestellt";
  if (zeile.zugestellt.length < gesamt) return `Gesendet: ${String(zeile.zugestellt.length)} von ${String(gesamt)}`;

  return gesamt === 1 ? "An die Adresse gesendet" : `An alle ${String(gesamt)} Adressen gesendet`;
}

/**
 * What the re-send costs, said before the press rather than after it. **A stored link is a hash**,
 * so there is nothing to send a second time: re-sending mints, and the link that team already holds
 * stops opening anything.
 */
const ERNEUT_FOLGE = "Diese Teams bekommen einen neuen Link. Der Link, den sie schon haben, funktioniert danach nicht mehr.";

/**
 * One press for every admitted team of the season, on `POST` and `GET
 * /saisons/{saison_id}/einladungen/versand`. **The preview and the press read one rule on the
 * server**, so what the armed step lists is what the second press then does.
 */
export function FormEinladungVersandSection({
  saisonId,
  isFinishedSaison,
}: {
  saisonId: string;
  /** `REQ-EINLADUNG-002`: a finished season hands out no further links, and the panel explains instead of offering. */
  isFinishedSaison: boolean;
}) {
  const router = useRouter();
  const [vorschau, setVorschau] = useState<readonly FLEinladungVersandVorschauZeile[] | null>(null);
  const [ergebnis, setErgebnis] = useState<readonly EinladungVersandErgebnis[] | null>(null);
  const [erneut, setErneut] = useState(false);
  const [isLoadingVorschau, startVorschau] = useTransition();

  const { isConfirming, isPending: isSending, press, cancel } = useTwoPressConfirm();

  const panel = formPanel();

  const senden = async () => {
    const res = await postEinladungVersandAction({ id: saisonId, erneut: erneut });

    if (!res.success) {
      appToast.danger("Registrierungslinks nicht gesendet", { description: res.error });
      return;
    }

    setErgebnis(res.zeilen);
    // Dropped rather than kept: the rows it held were true before this write, and the skips it
    // listed have just moved.
    setVorschau(null);
    appToast.success("Registrierungslinks gesendet", { description: res.message });
    router.refresh();
  };

  const handlePress = () => {
    if (vorschau !== null) {
      press(senden);
      return;
    }

    startVorschau(async () => {
      // The value the PRESS will carry, so the list names the teams that press will write to: read
      // with the other value it would show a skip the press is about to ignore.
      const res = await previewEinladungVersandAction({ id: saisonId, erneut: erneut });

      if (!res.success) {
        appToast.danger("Vorschau nicht geladen", { description: res.error });
        return;
      }

      setVorschau(res.zeilen);
      // Armed in the gesture that asked for the list, so the reader meets the list and the armed
      // control together rather than pressing a third time to reach the same state.
      if (res.zeilen.some((zeile) => zeile.empfaenger.length > 0)) press(senden);
    });
  };

  /** Dropped with every change of the opt-in: the rule the server answered was read with the other value. */
  const changeErneut = (next: boolean) => {
    setErneut(next);
    setVorschau(null);
    setErgebnis(null);
    cancel();
  };

  const empfaengerGesamt = (vorschau ?? []).reduce((summe, zeile) => summe + zeile.empfaenger.length, 0);
  const teamsMitEmpfaenger = (vorschau ?? []).filter((zeile) => zeile.empfaenger.length > 0);
  // Counted off the ROWS and never inferred from the opt-in: a team holding a link nobody mailed is
  // written to with the opt-in off and loses that link all the same.
  const ersetzteLinks = (vorschau ?? []).filter((zeile) => zeile.ersetzt_link).length;

  const reason = isFinishedSaison
    ? "Für eine abgeschlossene Saison werden keine Registrierungslinks mehr ausgegeben."
    : vorschau !== null && vorschau.length === 0
      ? "Diese Saison hat noch kein Team aufgenommen."
      : vorschau !== null && empfaengerGesamt === 0
        ? "Kein Team dieser Saison hat eine bestätigte Adresse, an die der Link gehen kann."
        : null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Registrierungslinks senden">
          <Hint
            mode="reveal"
            label="Hinweis zum Versand"
            body={{
              lead: "Jedes aufgenommene Team bekommt seinen eigenen Registrierungslink per E-Mail.",
              points: [
                { term: "Jeder Versand", text: "legt einen frischen Link an und beendet den bisherigen des Teams." },
                { term: "Geschrieben wird", text: "nur an Kontaktpersonen, die ihre Daten selbst bestätigt haben." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {isFinishedSaison ? (
          <Callout
            severity="info"
            title="Für eine abgeschlossene Saison werden keine Registrierungslinks mehr gesendet"
          />
        ) : (
          <>
            <Switch
              isSelected={erneut}
              onChange={changeErneut}>
              <Switch.Content className={panel.switchContent()}>
                Auch an Teams, die ihren Link schon bekommen haben
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>

            {/* Under the switch and only while it is on: the cost is a property of the choice, and a
                standing sentence would state it about a press that is not going to make it. */}
            {erneut && <p className="muted-hint">{ERNEUT_FOLGE}</p>}

            {vorschau !== null && vorschau.length === 0 && (
              <Callout
                severity="info"
                title="Diese Saison hat noch kein Team aufgenommen">
                Nimm die Teams über die Teamseite in die Saison auf.
              </Callout>
            )}

            {vorschau !== null && vorschau.length > 0 && (
              <div className="flex w-full flex-col gap-y-2">
                <h3 className={FORM_SECTION_HEADING}>Wer den Link bekommt</h3>
                <ul className="flex w-full flex-col gap-y-1">
                  {vorschau.map((zeile) => (
                    <li
                      key={zeile.team_id}
                      className="fluid-xxs text-foreground flex flex-row items-baseline justify-between gap-x-3 leading-normal font-medium">
                      <span className="font-bold">{zeile.team_name}</span>
                      <span className="text-foreground-muted min-w-0 text-right">
                        {zeile.uebersprungen === null ? (
                          <>
                            {zeile.empfaenger.map((seat) => seat.email).join(", ")}
                            {zeile.ersetzt_link && <span className="text-warning-strong block font-bold">{ERSETZT_SATZ}</span>}
                          </>
                        ) : (
                          UEBERSPRUNGEN_SATZ[zeile.uebersprungen]
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ergebnis !== null && ergebnis.length > 0 && (
              <div className="flex w-full flex-col gap-y-2">
                <h3 className={FORM_SECTION_HEADING}>Was gesendet wurde</h3>
                <ul className="flex w-full flex-col gap-y-1">
                  {ergebnis.map((zeile) => (
                    <li
                      key={zeile.team_id}
                      className="fluid-xxs text-foreground flex flex-row items-baseline justify-between gap-x-3 leading-normal font-medium">
                      <span className="font-bold">{zeile.team_name}</span>
                      <span className="text-foreground-muted min-w-0 text-right">
                        {/* Graded apart from the other skips: there the league failed the team
                            rather than passing it over. */}
                        {zeile.uebersprungen === "erzeugung_fehlgeschlagen" ? (
                          <>
                            <span className="text-danger-strong font-bold">{UEBERSPRUNGEN_SATZ[zeile.uebersprungen]}</span>
                            <span className="block">{FEHLGESCHLAGEN_FOLGE}</span>
                          </>
                        ) : zeile.uebersprungen !== null ? (
                          UEBERSPRUNGEN_SATZ[zeile.uebersprungen]
                        ) : (
                          <>
                            {zustellSatz(zeile)}
                            {/* The addresses themselves, as the preview lists them: a count of what
                                failed names nobody to write to by hand. A withheld one is dropped —
                                nobody tried it, so there is nothing to write to by hand. */}
                            {nichtErreicht(zeile).length > 0 && (
                              <span className="text-danger-strong block font-bold">Nicht erreicht: {nichtErreicht(zeile).join(", ")}</span>
                            )}
                            {zeile.ersetzt_link && <span className="text-warning-strong block font-bold">{ERSETZT_VERGANGEN}</span>}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isConfirming && (
              <ConfirmReveal>
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING}>Was jetzt hinausgeht</h3>
                  <dl className="flex w-full flex-col gap-y-1">
                    <ConfirmReadoutRow
                      label="Teams"
                      value={String(teamsMitEmpfaenger.length)}
                    />
                    <ConfirmReadoutRow
                      label="E-Mails"
                      value={String(empfaengerGesamt)}
                    />
                    <ConfirmReadoutRow
                      label="Übersprungen"
                      value={String((vorschau ?? []).length - teamsMitEmpfaenger.length)}
                    />
                    <ConfirmReadoutRow
                      label="Verlieren ihren Link"
                      value={String(ersetzteLinks)}
                    />
                  </dl>
                </div>

                {/* Off the ROWS rather than off the opt-in, and again HERE rather than at the switch
                    alone: the armed step is the last thing read before the write. */}
                {/* The count stays in the readout above and out of the sentence: a numeral written
                    before a plural noun reads wrong at one, and the recast keeps both readings. */}
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  {ersetzteLinks > 0
                    ? "Jedes dieser Teams bekommt einen frischen Link. Bei den Teams, die ihren Link verlieren, funktioniert der bisherige danach nicht mehr. Zurückholen lässt sich eine E-Mail nicht."
                    : "Jedes dieser Teams bekommt einen frischen Link. Zurückholen lässt sich eine E-Mail nicht."}
                </p>
              </ConfirmReveal>
            )}

            <ConfirmActionRow
              isConfirming={isConfirming}
              isPending={isSending}
              onCancel={cancel}>
              <ConfirmPressButton
                isConfirming={isConfirming}
                isPending={isSending}
                // The read the press waits on, which is pending-marked without claiming a write has
                // started: nothing is written until the armed press.
                held={isLoadingVorschau}
                reason={reason}
                resting={SENDEN_LABEL}
                armed={SENDEN_ARMED}
                running="Sendet..."
                icon={
                  <Envelope
                    className="size-4.5"
                    aria-hidden="true"
                  />
                }
                onPress={handlePress}
              />
            </ConfirmActionRow>
          </>
        )}
      </div>
    </section>
  );
}
