"use client";

import { startTransition, useState, useTransition } from "react";

import ChevronsDownWide from "@gravity-ui/icons/ChevronsDownWide";
import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { Button } from "@heroui/react/button";
import { Disclosure } from "@heroui/react/disclosure";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { EINSAETZE_TITEL } from "@/core/seitenNamen";
import { absagenSpielbestaetigungAction, zusagenSpielbestaetigungAction } from "@/features/spielbestaetigungen/personActions";
import { SchiedsrichterAbsageSchema } from "@/features/spielbestaetigungen/schemas";
import {
  ABSAGE_GESPEICHERT,
  ABSAGE_NICHT_GESPEICHERT,
  terminText,
  ZUSAGE_GESPEICHERT,
  ZUSAGE_NICHT_GESPEICHERT,
} from "@/features/spielbestaetigungen/utils";
import { SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH } from "@/features/spiele/constants";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import {
  FIELD_ERROR_CLASSES,
  FIELD_INPUT_CLASSES,
  FIELD_LABEL_CLASSES,
  FIELD_PAIR_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { focusAfterWrite, focusRow, focusSection, focusSlot } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSpielbestaetigungSelbst, FLSpielbestaetigungSelbstZustand } from "@/core/generated/client/types";

const EINSAETZE_LEER = "Du bist zurzeit für kein Spiel eingeteilt.";

/** The fixtures whose day has gone by, listed apart below the ones to come, which a season's past would bury. */
const VERGANGENE_EINSAETZE = "Vergangene Einsätze";

/** The place each answer's control holds in every open row, so an answered row hands the focus to the same control in the next. */
const ZUSAGEN = "zusagen";
const ABSAGEN = "absagen";

/** What a spent row says in place of its controls. */
const ERLEDIGT: Record<Exclude<FLSpielbestaetigungSelbstZustand, "gueltig">, { text: string; ton: "success" | "danger" | null }> = {
  zugesagt: { text: "Zugesagt", ton: "success" },
  abgelehnt: { text: "Abgesagt", ton: "danger" },
  abgelaufen: { text: "Keine Antwort mehr möglich", ton: null },
  ungueltig: { text: "Nicht mehr gültig: Termin oder Einteilung haben sich geändert", ton: null },
  // The fixture's word as `SCHLIESSGRUND_LABELS` gives it, never „Abgesagt“ alone, which is the referee's own decline above.
  abgesagt: { text: "Spiel abgesagt", ton: "danger" },
};

/** A Zusage the league entered, which puts the referee on the schedule as their own would: never read as theirs. */
const EINGETRAGEN = { text: "Zusage von der Verwaltung eingetragen", ton: "success" } as const;

/**
 * The Einteilung's mail leads here. Its own empty state stands beside the referee's data, and its heading stays when
 * the last open row is answered, so the focus has somewhere to land.
 */
export function SchiedsrichterEinsaetzeSection({ einsaetze }: { einsaetze: readonly FLSpielbestaetigungSelbst[] }) {
  const panel = formPanel();
  // Split as the read ordered them, which judged the day: the ones to come first, then the past, the latest first.
  const kommend = einsaetze.filter((einsatz) => !einsatz.vergangen);
  const vergangen = einsaetze.filter((einsatz) => einsatz.vergangen);

  return (
    <section
      className={panel.root()}
      {...focusSection("einsaetze")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={EINSAETZE_TITEL}>
          <Hint
            mode="reveal"
            label="Hinweis zu Deinen Einsätzen"
            body={{
              lead: "Die Spiele, für die Dich die Verwaltung der Liga als Schiedsrichterin oder Schiedsrichter eingeteilt hat. Sag zu jedem Spiel zu oder ab.",
              points: [
                {
                  text: "Hat die Verwaltung Dich zu einem Spiel gefragt, steht es erst mit Dir im Spielplan, wenn Du zugesagt hast oder die Verwaltung Deine Zusage eingetragen hat.",
                },
                { text: "Sagst Du ab, teilt die Verwaltung jemand anderen ein." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {kommend.length === 0 ? (
          <p className="muted-hint">{EINSAETZE_LEER}</p>
        ) : (
          <ul
            aria-label="Liste Deiner Einsätze"
            className="flex w-full flex-col gap-3">
            {kommend.map((einsatz) => (
              <EinsatzKarte
                key={einsatz.id}
                einsatz={einsatz}
              />
            ))}
          </ul>
        )}

        {vergangen.length > 0 && (
          <div className="flex w-full flex-col gap-3">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>{VERGANGENE_EINSAETZE}</h3>
            <ul
              aria-label="Liste Deiner vergangenen Einsätze"
              className="flex w-full flex-col gap-3">
              {vergangen.map((einsatz) => (
                <EinsatzKarte
                  key={einsatz.id}
                  einsatz={einsatz}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** One row's card. Its own component so each card holds its own reason draft and pending press. */
function EinsatzKarte({ einsatz }: { einsatz: FLSpielbestaetigungSelbst }) {
  const { ansetzung } = einsatz;
  const paarung = `${ansetzung.team1_name} gegen ${ansetzung.team2_name}`;
  const datum = formatSpielDatum(ansetzung.datum);

  return (
    <li
      className={`${card()} flex w-full flex-col gap-4 p-4`}
      {...focusRow(einsatz.id)}>
      <div className="flex flex-col gap-y-2">
        <p className="fluid-sm font-bold text-pretty text-foreground">{paarung}</p>
        {einsatz.zustand !== "gueltig" && <Erledigt einsatz={einsatz} />}
      </div>

      <dl className={FIELD_PAIR_CLASSES}>
        <Angabe label="Termin">{terminText(ansetzung)}</Angabe>
        <Angabe label="Ort">{ansetzung.spielort?.name ?? <Leer />}</Angabe>
        {einsatz.zustand === "abgelehnt" && <Angabe label="Begründung">{einsatz.begruendung ?? <Leer />}</Angabe>}
      </dl>

      {einsatz.zustand === "gueltig" && (
        <Antwort
          spielbestaetigungId={einsatz.id}
          // The words first, which speech input says, then what tells the rows' controls apart (WCAG 2.5.3).
          wofuer={`${paarung} am ${datum}`}
        />
      )}
    </li>
  );
}

function Erledigt({ einsatz }: { einsatz: FLSpielbestaetigungSelbst }) {
  if (einsatz.zustand === "gueltig") return null;
  const { text, ton } = einsatz.zustand === "zugesagt" && einsatz.eingetragen ? EINGETRAGEN : ERLEDIGT[einsatz.zustand];

  return ton === null ? <Leer>{text}</Leer> : <span className={`${labelBadge(ton)} w-fit`}>{text}</span>;
}

/**
 * The two answers to one open row: a Zusage armed by its first press and sent by its second, the first answer binding,
 * and a decline behind the disclosure, which takes no answer without its reason. Each is one write.
 */
function Antwort({ spielbestaetigungId, wofuer }: { spielbestaetigungId: string; wofuer: string }) {
  const zusage = useTwoPressConfirm();
  const [isSendingAbsage, startSendingAbsage] = useTransition();
  const [begruendung, setBegruendung] = useState("");

  // The payload the action parses, judging the draft too: a second schema here would refuse at rules the action does not.
  const { reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } = useDraftFieldErrors({
    schemas: { absage: SchiedsrichterAbsageSchema },
    failureTitle: ABSAGE_NICHT_GESPEICHERT,
  });

  const absage = { begruendung: begruendung };
  useForgiveFixed({ absage: absage });

  const sendeZusage = () => {
    const landing = focusAfterWrite();
    zusage.press(async () => {
      // A rejected action may still have written, and uncaught here it takes the page down with it.
      const res = await zusagenSpielbestaetigungAction(spielbestaetigungId).catch(unansweredAction);

      // Wrapped again: React leaves an update after an `await` outside the transition that awaited.
      startTransition(() => {
        if (!res.success) {
          appToast.failure(ZUSAGE_NICHT_GESPEICHERT, res);
          return;
        }
        landing.landed();
        appToast.success(ZUSAGE_GESPEICHERT);
      });
    });
  };

  // The form's own submit is the decline's, so an Enter in the reason box never sends a Zusage.
  const sendeAbsage = () => {
    guardSubmit({ absage: absage }, () => {
      const landing = focusAfterWrite();
      startSendingAbsage(async () => {
        const res = await absagenSpielbestaetigungAction(spielbestaetigungId, absage).catch(unansweredAction);

        startTransition(() => {
          if (!res.success) {
            // The hook owns the press's one toast: none where the box shows the refusal.
            reportSubmitFailure(res, { absage: absage }, { raise: (shown) => appToast.failure(ABSAGE_NICHT_GESPEICHERT, shown) });
            return;
          }
          landing.landed();
          appToast.success(ABSAGE_GESPEICHERT);
        });
      });
    });
  };

  return (
    <Form
      wiring={formWiring}
      data-required-marks="on"
      className="flex w-full flex-col gap-4"
      onSubmit={sendeAbsage}>
      <ConfirmActionRow confirm={zusage}>
        <FocusSlot name={ZUSAGEN}>
          <ConfirmPressButton
            confirm={zusage}
            // Held, never relabelled, while the decline is sending: both wait on the one write in flight.
            held={isSendingAbsage}
            reason={null}
            resting="Zusagen"
            restingName={benannt("Zusagen", wofuer)}
            armed="Ja, zusagen"
            running="Sagt zu..."
            icon={
              <CircleCheck
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={sendeZusage}
          />
        </FocusSlot>
      </ConfirmActionRow>

      {zusage.isConfirming && (
        <ConfirmReveal>
          <p className="fluid-sm text-pretty text-foreground">Du sagst für dieses Spiel zu. Das lässt sich hier nicht rückgängig machen.</p>
        </ConfirmReveal>
      )}

      <div
        // Hidden while the Zusage is armed, as a registration's second answer is: one row arms one answer at a time.
        hidden={zusage.isConfirming}
        // Around the whole disclosure: the decline is sent from its submit, which a slot on the trigger alone misses.
        {...focusSlot(ABSAGEN)}>
        <Disclosure>
          <Disclosure.Heading level={3}>
            <Disclosure.Trigger
              aria-label={benannt("Absagen", wofuer)}
              className="flex w-fit items-center gap-x-2 fluid-sm font-bold text-foreground">
              Absagen
              <Disclosure.Indicator className="shrink-0 text-foreground-muted">
                <ChevronsDownWide
                  aria-hidden="true"
                  className="size-5"
                />
              </Disclosure.Indicator>
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="flex flex-col gap-y-4 pt-3">
              {/* One line, as the endpoint stores it: a line break is refused rather than kept. */}
              <TextField
                name="begruendung"
                value={begruendung}
                onChange={setBegruendung}
                onBlur={() => validatePaths("absage", absage, ["begruendung"])}
                maxLength={SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH}>
                {/* The row heard after the visible word, as the admin panel's box names its party: two open rows hold a box each. */}
                <Label className={FIELD_LABEL_CLASSES}>
                  Begründung<span className="sr-only">: {wofuer}</span>
                </Label>
                <Input className={FIELD_INPUT_CLASSES} />
                <FieldError className={FIELD_ERROR_CLASSES} />
                <Hint
                  mode="field"
                  text="Nur die Verwaltung der Liga liest sie. Nenne darin keine Namen."
                />
              </TextField>

              <div className="flex w-full flex-col items-stretch sm:flex-row sm:justify-end">
                <Button
                  type="submit"
                  isPending={isSendingAbsage || zusage.isPending}
                  className={formButton({ intent: "submit", stacks: true })}>
                  {isSendingAbsage ? (
                    "Sendet..."
                  ) : (
                    <>
                      Absage senden<span className="sr-only">: {wofuer}</span>
                    </>
                  )}
                </Button>
              </div>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </div>
    </Form>
  );
}
