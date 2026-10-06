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

import { WAHL_GESPEICHERT, WAHL_NICHT_GESPEICHERT } from "../../../einwilligung";

import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { FLKontaktKenntnisnahme } from "@/features/teams/schemas";
import type { ActionFailure } from "@/shared/types/types";
import type { Key } from "@heroui/react/rac";
import type { ReactNode } from "react";

type PersonUmfang = FLEinwilligung["umfang"];
type SitzUmfang = FLKontaktKenntnisnahme["umfang"];

/** The chips in the order a reader meets them: the wider publication first, as the confirmation pages ask it. */
const UMFANG_REIHENFOLGE: readonly PersonUmfang[] = ["kader_oeffentlich", "intern"];

/** The seat's scope a switch turned on writes, and the one it writes turned off. */
const MIT_WHATSAPP: SitzUmfang = "kontaktdaten_whatsapp";
const OHNE_WHATSAPP: SitzUmfang = "kontaktdaten";

/**
 * The two choices one record holds: a pupil's or a referee's publication scope beside the media
 * consent, or a contact seat's contact scope, WhatsApp or not, beside it.
 */
export type EinwilligungWahl = { readonly umfang: PersonUmfang | SitzUmfang; readonly medien: boolean };

// A record carries `umfang`'s chips or `whatsapp`'s switch, as its scope is a person's or a seat's.
/**
 * The words one control shows, every slot already filled. A name is a string because it is the
 * control's accessible name; a paragraph is a node because it may carry the privacy link.
 */
export type EinwilligungWorte = {
  /** The label the words below belong to, posted back with every press so the record names what was on screen. */
  readonly textVersion: string;
  readonly umfang?: { readonly frage: string; readonly optionen: Readonly<Record<PersonUmfang, string>>; readonly absatz: ReactNode };
  readonly whatsapp?: { readonly schalter: string; readonly absatz: ReactNode };
  readonly medien: { readonly schalter: string; readonly absatz: ReactNode };
  /** Why a record offers a withdrawal alone where its person would look for a grant too, read with each switch. */
  readonly nurWiderruf?: string;
  /** What a change takes effect from, and that a record granting no panel takes a withdrawal alone. */
  readonly widerruf: ReactNode;
};

/**
 * Each choice's stand as the backend last served it, echoed unchanged: a press from a page another
 * press has moved since is refused rather than undoing that press.
 */
export type EinwilligungStand = { readonly umfang: string | null; readonly medien: string | null };

/** What a press sends: the whole record's choices, so moving one never resets the other. */
export type EinwilligungAntwort<W extends EinwilligungWahl = EinwilligungWahl, S extends EinwilligungStand = EinwilligungStand> = W & {
  readonly text_version: string;
  readonly nachweis_stand: S;
};

/** A landed press's answer carries the stand it left, which the next press sends. */
type Gespeichert<S> = { readonly success: true; readonly nachweis_stand: S };

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
  beschreibung: string;
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

/**
 * One consent record's controls, each saved by its own press. Every record a person holds renders
 * through this one component, so the pupil's, the referee's, a seat's and a registration's cannot drift
 * apart in wording or behaviour (`docs/frontend/spec.md :: I891`).
 */
export function EinwilligungForm<W extends EinwilligungWahl, S extends EinwilligungStand>({
  worte,
  gespeichert,
  nachweisStand,
  medienAngeboten,
  erteilbar,
  speichereAction,
}: {
  worte: EinwilligungWorte;
  /** The record as the page read it; the controls show it again once a press has been answered. */
  gespeichert: W;
  /** The stand the page was served with the record. */
  nachweisStand: S;
  /** The backend's verdict on the person's age; a media consent already given stays withdrawable without it. */
  medienAngeboten: boolean;
  /** Whether the record admits a grant; one that grants no panel takes a withdrawal alone, which is never closed. */
  erteilbar: boolean;
  /** Typed by the record's own payload, so a field its write's mirror gains fails the page that binds it. */
  speichereAction: (antwort: EinwilligungAntwort<W, S>) => Promise<Gespeichert<S> | ActionFailure>;
}) {
  const router = useRouter();
  const frageId = useId();
  const umfangAbsatzId = useId();
  const whatsappAbsatzId = useId();
  const medienAbsatzId = useId();
  const nurWiderrufId = useId();
  const widerrufId = useId();

  // Shown until the press's answer re-reads the page: the action's spine refreshes it after a landed
  // write, and a refused one falls back to what the page last read.
  const [wahl, setWahl] = useOptimistic(gespeichert);

  // The record and stand the backend holds as far as the page knows: the read's, then each landed press's.
  const gehalten = useRef({ wahl: gespeichert, stand: nachweisStand });
  const vorige = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    gehalten.current = { wahl: gespeichert, stand: nachweisStand };
  }, [gespeichert, nachweisStand]);

  // One press at a time, each the held record plus its own change: built from the screen, a press after
  // a refused grant would carry the grant along, and one sent unanswered a stand that press moves.
  const waehle = (aenderung: Partial<EinwilligungWahl>): void => {
    // Read at the press: a withdrawal can close the switch it was pressed on (`docs/frontend/spec.md :: I536`).
    const landung = focusAfterWrite();
    startTransition(async () => {
      setWahl((gezeigt) => ({ ...gezeigt, ...aenderung }));
      const press = vorige.current.then(async () => {
        const naechste: W = { ...gehalten.current.wahl, ...aenderung };
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

  // What a closed grant is described by beyond its own paragraph: the record's reason for taking a
  // withdrawal alone, or the closing paragraph saying which records do.
  const grundIds = (absatzId: string, geschlossen: boolean): string =>
    [absatzId, ...(worte.nurWiderruf === undefined ? (geschlossen && !erteilbar ? [widerrufId] : []) : [nurWiderrufId])].join(" ");

  // The stored record, never the pressed value, decides whether a grant is closed: a switch just turned
  // off stays open until the page is read again (`docs/frontend/spec.md :: I892`).
  const whatsappGeschlossen = !erteilbar && gespeichert.umfang !== MIT_WHATSAPP;
  const medienGeschlossen = !(erteilbar && medienAngeboten) && !gespeichert.medien;

  const { umfang, whatsapp } = worte;

  return (
    <div className="flex w-full flex-col gap-y-6">
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
              const gewaehlt = UMFANG_REIHENFOLGE.find((option) => option === picked);
              if (gewaehlt !== undefined && gewaehlt !== wahl.umfang) waehle({ umfang: gewaehlt });
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            {UMFANG_REIHENFOLGE.map((option) => {
              // The wider publication is the grant: closed on a record granting no panel, unless the
              // record holds it, and the other chip then withdraws it.
              const geschlossen = !erteilbar && option === "kader_oeffentlich" && gespeichert.umfang !== option;

              return (
                <ToggleButton
                  key={option}
                  id={option}
                  isDisabled={geschlossen}
                  aria-describedby={geschlossen ? (worte.nurWiderruf === undefined ? widerrufId : nurWiderrufId) : undefined}
                  className={OPTION_CHIP_CLASSES}>
                  {umfang.optionen[option]}
                </ToggleButton>
              );
            })}
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
            an={wahl.umfang === MIT_WHATSAPP}
            geschlossen={whatsappGeschlossen}
            beschreibung={grundIds(whatsappAbsatzId, whatsappGeschlossen)}
            onChange={(an) => waehle({ umfang: an ? MIT_WHATSAPP : OHNE_WHATSAPP })}
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
          geschlossen={medienGeschlossen}
          beschreibung={grundIds(medienAbsatzId, medienGeschlossen)}
          onChange={(medien) => waehle({ medien: medien })}
        />
        <p
          id={medienAbsatzId}
          className={ABSATZ_CLASSES}>
          {worte.medien.absatz}
        </p>
        {worte.nurWiderruf !== undefined && (
          <p
            id={nurWiderrufId}
            className={ABSATZ_CLASSES}>
            {worte.nurWiderruf}
          </p>
        )}
      </div>

      <p
        id={widerrufId}
        className={ABSATZ_CLASSES}>
        {worte.widerruf}
      </p>
    </div>
  );
}
