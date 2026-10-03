"use client";

import { startTransition } from "react";

import Ban from "@gravity-ui/icons/Ban";
import SealCheck from "@gravity-ui/icons/SealCheck";

import { Button } from "@heroui/react/button";

import { ablehnenRegistrierungAction, aufnehmenRegistrierungAction } from "@/features/registrierungen/personActions";
import { ANGABEN_WEICHEN_AB, dieselbePerson, NOCH_NICHT_BESTAETIGT, personName } from "@/features/registrierungen/utils";
import {
  IDENTITY_HEAD_CLASSES,
  IDENTITY_LINE_CLASSES,
  IDENTITY_NAME_CLASSES,
  IDENTITY_ROW_CLASSES,
  IDENTITY_STACK_CLASSES,
} from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite, focusRow } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLOffeneRegistrierung, FLRegistrierungAblehnungsgrund } from "@/features/registrierungen/schemas";
import type { ActionResult } from "@/shared/types/types";

/** The place each decision's control holds in every row, so a decided row hands the focus to the same control in the next. */
const AUFNEHMEN = "aufnehmen";
const ABLEHNEN = "ablehnen";

/** The team and season the page stands at, which every press claims its seat on. */
type Adresse = { team_id: string; saison_id: string };

/**
 * **A card per registration at every width, never a table**: a registration is a record. Every
 * pending row is listed, the unconfirmed ones too, so a team can tell nobody registering from
 * somebody not yet answering their link.
 */
export function RegistrierungenList({ registrierungen, adresse }: { registrierungen: readonly FLOffeneRegistrierung[]; adresse: Adresse }) {
  return (
    // Named here because the section heading over it names the queue, not the list.
    <ul
      aria-label="Liste der offenen Registrierungen"
      className="flex w-full flex-col gap-3">
      {registrierungen.map((registrierung) => (
        <RegistrierungKarte
          key={registrierung.registrierung_id}
          registrierung={registrierung}
          adresse={adresse}
        />
      ))}
    </ul>
  );
}

/**
 * One row's card. Its own component so each card holds its own armed state (`docs/frontend/spec.md :: I37`):
 * one state shared across the list would leave a second card one press from a decision armed on the first.
 */
function RegistrierungKarte({ registrierung, adresse }: { registrierung: FLOffeneRegistrierung; adresse: Adresse }) {
  const aufnahme = useTwoPressConfirm();
  const ablehnung = useTwoPressConfirm();
  const name = `${registrierung.vorname} ${registrierung.nachname}`;
  const { person, vorschlag } = registrierung;
  const ziel = { ...adresse, registrierung_id: registrierung.registrierung_id };

  /** Both decisions take the row off the list, so the press's place is read now and landed on once the write succeeded. */
  const entscheide = (confirm: typeof aufnahme, write: () => Promise<ActionResult>, titel: { erfolg: string; fehler: string }) => {
    const landing = focusAfterWrite();
    confirm.press(async () => {
      // A rejected action may still have written, and uncaught here it takes the page down with it.
      const res = await write().catch(unansweredAction);

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an `await` outside it.
      startTransition(() => {
        if (!res.success) {
          appToast.failure(titel.fehler, res);
          return;
        }
        landing.landed();
        appToast.success(titel.erfolg, { description: res.message });
      });
    });
  };

  const aufnehmen = (spielerId: string | null) =>
    entscheide(aufnahme, () => aufnehmenRegistrierungAction({ ...ziel, spieler_id: spielerId }), {
      erfolg: "Registrierung aufgenommen",
      fehler: "Registrierung nicht aufgenommen",
    });

  const ablehnen = (confirm: typeof aufnahme, grund: FLRegistrierungAblehnungsgrund | null) =>
    entscheide(confirm, () => ablehnenRegistrierungAction({ ...ziel, grund: grund }), {
      erfolg: "Registrierung abgelehnt",
      fehler: "Registrierung nicht abgelehnt",
    });

  // The address resolved to somebody whose details differ: the yes names that person, and the no is a
  // decline telling the pupil to register under an address of their own.
  const gefragt = person !== null && person.weicht_ab;
  // A proposal has its own yes, and the armed press is then its no: the pupil becomes a new person.
  const vorgeschlagen = person === null ? vorschlag : null;

  return (
    <li
      className={`${card()} flex w-full flex-col gap-3 p-4`}
      {...focusRow(registrierung.registrierung_id)}>
      <div className={IDENTITY_ROW_CLASSES}>
        <span
          aria-label={registrierung.nummer === null ? "Keine Nummer" : undefined}
          className={`inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-numeric fluid-xs font-extrabold tracking-wide tabular-nums ${
            registrierung.nummer === null ? "bg-muted/50" : "bg-muted text-foreground"
          }`}>
          {registrierung.nummer ?? ""}
        </span>
        <div className={IDENTITY_STACK_CLASSES}>
          <div className={IDENTITY_HEAD_CLASSES}>
            <span className={IDENTITY_NAME_CLASSES}>{name}</span>
            {!registrierung.aufnehmbar && <span className={labelBadge("warning")}>Noch nicht bestätigt</span>}
            {person !== null && <span className={labelBadge("info")}>War schon in der Liga</span>}
            {registrierung.nummer_doppelt && <span className={labelBadge("warning")}>Nummer doppelt</span>}
          </div>
          {(registrierung.position !== null || registrierung.stufe !== null) && (
            <span className={IDENTITY_LINE_CLASSES}>
              {[registrierung.position, registrierung.stufe].filter((teil) => teil !== null).join(" · ")}
            </span>
          )}
          <span className={IDENTITY_LINE_CLASSES}>Registriert am {formatSpielDatum(registrierung.eingereicht_am)}</span>
        </div>
      </div>

      {aufnahme.isConfirming && (
        <ConfirmReveal>
          {gefragt && (
            <p className="fluid-sm text-pretty text-foreground">
              {ANGABEN_WEICHEN_AB} {dieselbePerson(personName(person))}
            </p>
          )}
          {gefragt && (
            <p className="fluid-sm text-pretty text-foreground">
              Ist sie es nicht, lehnst Du die Registrierung ab, und die Person wird gebeten, sich mit einer eigenen E-Mail-Adresse erneut zu
              registrieren.
            </p>
          )}
          {vorgeschlagen !== null && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="fluid-sm text-pretty text-foreground">{dieselbePerson(personName(vorgeschlagen))}</p>
              {/* The admission's place: a decided row hands the focus to the next row's admission. */}
              <FocusSlot name={AUFNEHMEN}>
                <Button
                  type="button"
                  variant="secondary"
                  isPending={aufnahme.isPending}
                  onPress={() => aufnehmen(vorgeschlagen.spieler_id)}
                  className={formButton({ intent: "cancel", stacks: true })}>
                  {`Ja, das ist ${personName(vorgeschlagen)}`}
                </Button>
              </FocusSlot>
            </div>
          )}
          {!gefragt && vorgeschlagen === null && (
            <p className="fluid-sm text-pretty text-foreground">{registrierung.vorname} kommt in den Kader dieser Saison.</p>
          )}
        </ConfirmReveal>
      )}
      {ablehnung.isConfirming && (
        <ConfirmReveal>
          <p className="fluid-sm text-pretty text-foreground">Die Registrierung wird abgelehnt. Das lässt sich nicht rückgängig machen.</p>
        </ConfirmReveal>
      )}

      {aufnahme.isConfirming ? (
        <ConfirmActionRow confirm={aufnahme}>
          <FocusSlot name={AUFNEHMEN}>
            <ConfirmPressButton
              confirm={aufnahme}
              reason={null}
              resting="Aufnehmen"
              armed={vorgeschlagen === null ? "Ja, aufnehmen" : "Nein, als neue Person aufnehmen"}
              running="Nimmt auf..."
              icon={
                <SealCheck
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
              }
              onPress={() => aufnehmen(gefragt ? person.spieler_id : null)}
            />
          </FocusSlot>
          {gefragt && (
            <FocusSlot name={AUFNEHMEN}>
              <Button
                type="button"
                variant="secondary"
                isPending={aufnahme.isPending}
                onPress={() => ablehnen(aufnahme, "andere_person")}
                className={formButton({ intent: "cancel", stacks: true })}>
                Nein
              </Button>
            </FocusSlot>
          )}
        </ConfirmActionRow>
      ) : ablehnung.isConfirming ? (
        <ConfirmActionRow confirm={ablehnung}>
          <FocusSlot name={ABLEHNEN}>
            <ConfirmPressButton
              confirm={ablehnung}
              reason={null}
              resting="Ablehnen"
              armed="Ja, ablehnen"
              running="Lehnt ab..."
              icon={
                <Ban
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
              }
              onPress={() => ablehnen(ablehnung, null)}
            />
          </FocusSlot>
        </ConfirmActionRow>
      ) : (
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <FocusSlot name={AUFNEHMEN}>
            <ConfirmPressButton
              confirm={aufnahme}
              // Closed rather than hidden: the control names what this row is waiting for.
              reason={registrierung.aufnehmbar ? null : NOCH_NICHT_BESTAETIGT}
              resting="Aufnehmen"
              restingName={`${name} aufnehmen`}
              armed="Ja, aufnehmen"
              running="Nimmt auf..."
              icon={
                <SealCheck
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
              }
              onPress={() => aufnehmen(null)}
            />
          </FocusSlot>
          <FocusSlot name={ABLEHNEN}>
            <ConfirmPressButton
              confirm={ablehnung}
              reason={null}
              resting="Ablehnen"
              restingName={`Registrierung von ${name} ablehnen`}
              armed="Ja, ablehnen"
              running="Lehnt ab..."
              icon={
                <Ban
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
              }
              onPress={() => ablehnen(ablehnung, null)}
            />
          </FocusSlot>
        </div>
      )}
    </li>
  );
}
