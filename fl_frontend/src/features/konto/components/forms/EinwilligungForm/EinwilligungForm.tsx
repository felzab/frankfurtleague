"use client";

import { startTransition, useEffect, useId, useOptimistic, useRef } from "react";
import { useRouter } from "next/navigation";

import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { ABSATZ_CLASSES } from "@/features/bewerbungen/components/ui/Gefuellt";
import { FIELD_LABEL_CLASSES, TOGGLE_GROUP_ALIGN_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { OPTION_CHIP_CLASSES } from "@/shared/components/ui/optionChip";
import { Switch } from "@/shared/components/ui/Switch";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite, focusSlot } from "@/shared/utils/focusAfterWrite";

import { MEDIEN_ZU_JUNG, NUR_WIDERRUF, WAHL_GESPEICHERT, WAHL_NICHT_GESPEICHERT } from "../../../einwilligung";

import type { FLEinwilligung, FLEinwilligungStand } from "@/features/spieler/schemas";
import type { FLKontaktKenntnisnahme } from "@/features/teams/schemas";
import type { ActionFailure } from "@/shared/types/types";
import type { Key } from "@heroui/react/rac";
import type { ReactNode } from "react";

export type PersonUmfang = FLEinwilligung["umfang"];
export type SitzUmfang = FLKontaktKenntnisnahme["umfang"];
type Umfang = PersonUmfang | SitzUmfang;

/** The chips in the order a reader meets them: the wider publication first, as the confirmation pages ask it. */
const UMFANG_REIHENFOLGE: readonly PersonUmfang[] = ["kader_oeffentlich", "intern"];

/** The seat's scope its switch turned on writes, the wider one. */
const MIT_WHATSAPP: SitzUmfang = "kontaktdaten_whatsapp";

/**
 * The two choices one record holds: a pupil's or a referee's publication scope beside the media
 * consent, or a contact seat's contact scope, WhatsApp or not, beside it. `U` is the record's own scope.
 */
export type EinwilligungWahl<U extends Umfang = Umfang> = { readonly umfang: U; readonly medien: boolean };

/** One press: the one choice it moves, and the value it moves it to. */
type Wahl<U extends Umfang = Umfang> = { readonly wahl: "umfang"; readonly wert: U } | { readonly wahl: "medien"; readonly wert: boolean };

/** Whether a press moves its choice to the wider value, which is the grant: a withdrawal is never closed. */
const istGrant = (wahl: Wahl): boolean =>
  wahl.wahl === "medien" ? wahl.wert : wahl.wert === "kader_oeffentlich" || wahl.wert === MIT_WHATSAPP;

/** Whether the record already holds the press's value, which a press then keeps rather than grants. */
const hält = (gehalten: EinwilligungWahl, wahl: Wahl): boolean => gehalten[wahl.wahl] === wahl.wert;

/**
 * The words one control shows, every slot already filled: `umfang`'s chips or `whatsapp`'s switch, as the
 * scope `U` is a person's or a seat's. A name is a string because it is a control's accessible name.
 */
export type EinwilligungWorte<U extends Umfang = Umfang> = {
  /** The label the words below belong to, posted back with every press so the record names what was on screen. */
  readonly textVersion: string;
  /**
   * Keyed by the scope each chip writes. `never` on a seat's scope, so a person's words, chips and all,
   * handed to a seat's control fail the type check rather than inferring `U` as the seat's.
   */
  readonly umfang?: [U] extends [SitzUmfang]
    ? never
    : { readonly frage: string; readonly optionen: Readonly<Record<U & PersonUmfang, string>>; readonly absatz: ReactNode };
  /** With the scope it writes on and off, so a person's words cannot carry one. */
  readonly whatsapp?: { readonly schalter: string; readonly an: U & SitzUmfang; readonly aus: U & SitzUmfang; readonly absatz: ReactNode };
  readonly medien: { readonly schalter: string; readonly absatz: ReactNode };
  /** Why a record offers a withdrawal alone where its person would look for a grant too, read with every control. */
  readonly nurWiderruf?: string;
  /** What a change takes effect from. */
  readonly widerruf: ReactNode;
};

/** What a press sends: the whole record's choices, so moving one never resets the other. */
export type EinwilligungAntwort<U extends Umfang = Umfang> = EinwilligungWahl<U> & {
  readonly text_version: string;
  readonly nachweis_stand: FLEinwilligungStand;
};

/** A landed press's answer carries the stand it left, which the next press sends. */
type Gespeichert = { readonly success: true; readonly nachweis_stand: FLEinwilligungStand };

/**
 * One grant switch, closed where the record admits no grant and never left out, as its paragraph names it
 * (`docs/frontend/spec.md :: I_NEW_KFE_2`). Keyed by that state: a withdrawal closing it draws a new one,
 * which the focus lands past.
 */
function GrantSchalter({
  name,
  an,
  geschlossen,
  beschreibung,
  onChange,
}: {
  name: string;
  an: boolean;
  geschlossen: boolean;
  beschreibung: string | undefined;
  onChange: (an: boolean) => void;
}) {
  const panel = formPanel();

  return (
    <Switch
      key={geschlossen ? "geschlossen" : "offen"}
      className="flex w-full flex-col gap-y-1"
      aria-describedby={beschreibung}
      isDisabled={geschlossen}
      isSelected={an}
      onChange={onChange}>
      <Switch.Content className={panel.switchContent()}>
        {name}
        <Switch.Control className={panel.switchControl()}>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

/** One record's control, typed by the record's own scope `U`. */
export type EinwilligungFormProps<U extends Umfang> = {
  worte: EinwilligungWorte<U>;
  /** The record as the page read it; the controls show it again once a press has been answered. */
  gespeichert: EinwilligungWahl<U>;
  /** The stand the page was served with the record. */
  nachweisStand: FLEinwilligungStand;
  /** The backend's verdict on the person's age; a media consent already given stays withdrawable without it. */
  medienAngeboten: boolean;
  /** Whether the record admits a grant; one that grants no panel takes a withdrawal alone, which is never closed. */
  erteilbar: boolean;
  /** Typed by the record's own payload, so a field its write's mirror gains fails the page that binds it. */
  speichereAction: (antwort: EinwilligungAntwort<U>) => Promise<Gespeichert | ActionFailure>;
};

/**
 * One consent record's controls, each saved by its own press. Every record a person holds renders
 * through this one component, so the pupil's, the referee's, a seat's and a registration's cannot drift
 * apart in wording or behaviour (`docs/frontend/spec.md :: I891`).
 */
export function EinwilligungForm<U extends Umfang>({
  worte,
  gespeichert,
  nachweisStand,
  medienAngeboten,
  erteilbar,
  speichereAction,
}: EinwilligungFormProps<U>) {
  const router = useRouter();
  const frageId = useId();
  const umfangAbsatzId = useId();
  const whatsappAbsatzId = useId();
  const medienAbsatzId = useId();
  const nurWiderrufId = useId();

  // Shown until the press's answer re-reads the page: the action's spine refreshes it after a landed
  // write, and a refused one falls back to what the page last read.
  const [wahl, setWahl] = useOptimistic(gespeichert);

  // The record and stand the backend holds as far as the page knows: the read's, then each landed press's.
  const gehalten = useRef<{ wahl: EinwilligungWahl<U>; stand: FLEinwilligungStand }>({ wahl: gespeichert, stand: nachweisStand });
  const vorige = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    gehalten.current = { wahl: gespeichert, stand: nachweisStand };
  }, [gespeichert, nachweisStand]);

  // The one rule every control is closed by (`docs/frontend/spec.md :: I892`): a grant is closed where the
  // record admits none and does not already hold it, the media consent also below the age the backend names.
  const zu = (wahl_: Wahl, gehaltenWahl: EinwilligungWahl): boolean =>
    istGrant(wahl_) && !hält(gehaltenWahl, wahl_) && (!erteilbar || (wahl_.wahl === "medien" && !medienAngeboten));

  // Why a closed grant is closed, said where a press would otherwise go out and be refused: on a record
  // admitting a grant, only the media consent below the age closes.
  const grund = (): string => (erteilbar ? MEDIEN_ZU_JUNG : (worte.nurWiderruf ?? NUR_WIDERRUF));

  // Every control on a withdraw-only record is read with its reason, a closed one and an open one alike.
  const beschreibung = (...eigene: string[]): string | undefined => {
    const ids = [...eigene, ...(worte.nurWiderruf === undefined ? [] : [nurWiderrufId])];
    return ids.length === 0 ? undefined : ids.join(" ");
  };

  // One press at a time, each the held record plus its own change: built from the screen, a press after
  // a refused grant would carry the grant along, and one sent unanswered a stand that press moves.
  const waehle = (aenderung: Wahl<U>): void => {
    // Read at the press: a withdrawal can close the switch it was pressed on (`docs/frontend/spec.md :: I536`).
    const landung = focusAfterWrite();
    startTransition(async () => {
      setWahl((gezeigt) => ({ ...gezeigt, [aenderung.wahl]: aenderung.wert }));
      const press = vorige.current.then(async (): Promise<Gespeichert | ActionFailure> => {
        // Judged against the record as the last landed press left it: a withdrawal still on its way
        // leaves the switch open on screen, and a grant after it would be refused.
        if (zu(aenderung, gehalten.current.wahl)) return { success: false, error: grund() };

        const naechste: EinwilligungWahl<U> = { ...gehalten.current.wahl, [aenderung.wahl]: aenderung.wert };
        const answer = await speichereAction({
          ...naechste,
          text_version: worte.textVersion,
          nachweis_stand: gehalten.current.stand,
        }).catch(rejectedWrite(router));
        if (answer.success) gehalten.current = { wahl: naechste, stand: answer.nachweis_stand };
        return answer;
      });
      vorige.current = press;
      const result = await press;

      if (result.success) {
        appToast.success(WAHL_GESPEICHERT);
        landung.landed();
      } else appToast.failure(WAHL_NICHT_GESPEICHERT, result);
    });
  };

  const { umfang, whatsapp } = worte;
  // The chips this record's words offer, in reading order: a scope its words carry no chip for is not its own.
  const optionen =
    umfang === undefined ? [] : UMFANG_REIHENFOLGE.filter((option): option is U & PersonUmfang => Object.hasOwn(umfang.optionen, option));
  const medienWahl: Wahl = { wahl: "medien", wert: true };

  return (
    <div className="flex w-full flex-col gap-y-6">
      {/* Once, ahead of every control it explains, and outside each control's own slot. */}
      {worte.nurWiderruf !== undefined && (
        <p
          id={nurWiderrufId}
          className={ABSATZ_CLASSES}>
          {worte.nurWiderruf}
        </p>
      )}

      {umfang !== undefined && (
        <div className="flex w-full flex-col gap-y-3">
          <p
            id={frageId}
            className={FIELD_LABEL_CLASSES}>
            {umfang.frage}
          </p>
          <ToggleButtonGroup
            aria-labelledby={frageId}
            aria-describedby={umfangAbsatzId}
            size="sm"
            isDetached
            selectionMode="single"
            // A stored record always holds an answer, so no press may empty it.
            disallowEmptySelection
            selectedKeys={[wahl.umfang]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              const gewaehlt = optionen.find((option) => option === picked);
              if (gewaehlt !== undefined && gewaehlt !== wahl.umfang) waehle({ wahl: "umfang", wert: gewaehlt });
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            {optionen.map((option) => (
              <ToggleButton
                key={option}
                id={option}
                isDisabled={zu({ wahl: "umfang", wert: option }, gespeichert)}
                aria-describedby={beschreibung()}
                className={OPTION_CHIP_CLASSES}>
                {umfang.optionen[option]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <p
            id={umfangAbsatzId}
            className={ABSATZ_CLASSES}>
            {umfang.absatz}
          </p>
        </div>
      )}

      {whatsapp !== undefined && (
        <div
          {...focusSlot("whatsapp")}
          className="flex w-full flex-col gap-y-3">
          <GrantSchalter
            name={whatsapp.schalter}
            an={wahl.umfang === whatsapp.an}
            geschlossen={zu({ wahl: "umfang", wert: whatsapp.an }, gespeichert)}
            beschreibung={beschreibung(whatsappAbsatzId)}
            onChange={(an) => waehle({ wahl: "umfang", wert: an ? whatsapp.an : whatsapp.aus })}
          />
          <p
            id={whatsappAbsatzId}
            className={ABSATZ_CLASSES}>
            {whatsapp.absatz}
          </p>
        </div>
      )}

      <div
        {...focusSlot("medien")}
        className="flex w-full flex-col gap-y-3">
        <GrantSchalter
          name={worte.medien.schalter}
          an={wahl.medien}
          geschlossen={zu(medienWahl, gespeichert)}
          beschreibung={beschreibung(medienAbsatzId)}
          onChange={(medien) => waehle({ wahl: "medien", wert: medien })}
        />
        <p
          id={medienAbsatzId}
          className={ABSATZ_CLASSES}>
          {worte.medien.absatz}
        </p>
      </div>

      <p className={ABSATZ_CLASSES}>{worte.widerruf}</p>
    </div>
  );
}
