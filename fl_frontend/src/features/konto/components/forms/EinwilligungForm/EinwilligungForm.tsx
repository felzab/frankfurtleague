"use client";

import { startTransition, useId, useOptimistic } from "react";
import { useRouter } from "next/navigation";

import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { ABSATZ_CLASSES } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { FIELD_LABEL_CLASSES, TOGGLE_GROUP_ALIGN_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { OPTION_CHIP_CLASSES } from "@/shared/components/ui/optionChip";
import { Switch } from "@/shared/components/ui/Switch";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { WAHL_GESPEICHERT, WAHL_NICHT_GESPEICHERT } from "../../../einwilligung";

import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { ActionFailure } from "@/shared/types/types";
import type { Key } from "@heroui/react/rac";
import type { ReactNode } from "react";

type Umfang = FLEinwilligung["umfang"];

/** The chips in the order a reader meets them: the wider publication first, as the confirmation pages ask it. */
const UMFANG_REIHENFOLGE: readonly Umfang[] = ["kader_oeffentlich", "intern"];

/** The two choices one record holds; a contact seat's record holds no publication choice, so `umfang` is absent there. */
export type EinwilligungWahl = { readonly umfang?: Umfang; readonly medien: boolean };

/**
 * The words one control shows, every slot already filled. A name is a string because it is the
 * control's accessible name; a paragraph is a node because it may carry the privacy link.
 */
export type EinwilligungWorte = {
  /** The label the words below belong to, posted back with every press so the record names what was on screen. */
  readonly textVersion: string;
  readonly umfang?: { readonly frage: string; readonly optionen: Readonly<Record<Umfang, string>>; readonly absatz: ReactNode };
  readonly medien: { readonly schalter: string; readonly absatz: ReactNode };
  /** What a change takes effect from, and that a record granting no panel takes a withdrawal alone. */
  readonly widerruf: ReactNode;
};

/** What a press sends: the whole record's choices, so moving one never resets the other. */
export type EinwilligungAntwort = EinwilligungWahl & { readonly text_version: string };

/**
 * One consent record's controls: the publication chip pair and the media switch, each pressed on its
 * own and saved at once. Every record a person holds renders through this one component, so the
 * pupil's, the referee's and a contact seat's controls cannot drift apart in wording or behaviour.
 */
export function EinwilligungForm({
  worte,
  gespeichert,
  medienAngeboten,
  erteilbar,
  speichereAction,
}: {
  worte: EinwilligungWorte;
  /** The record as the page read it; the controls show it again once a press has been answered. */
  gespeichert: EinwilligungWahl;
  /** The backend's verdict on the person's age; a media consent already given stays withdrawable without it. */
  medienAngeboten: boolean;
  /** Whether the record admits a grant; one that grants no panel takes a withdrawal alone, which is never closed. */
  erteilbar: boolean;
  speichereAction: (antwort: EinwilligungAntwort) => Promise<{ readonly success: true } | ActionFailure>;
}) {
  const router = useRouter();
  const panel = formPanel();
  const frageId = useId();
  const umfangAbsatzId = useId();
  const medienAbsatzId = useId();
  const widerrufId = useId();

  // Shown until the press's answer re-reads the page: the action's spine refreshes it after a landed
  // write, and a refused one falls back to what the page last read.
  const [wahl, setWahl] = useOptimistic(gespeichert);

  const waehle = (naechste: EinwilligungWahl): void => {
    startTransition(async () => {
      setWahl(naechste);
      const result = await speichereAction({ ...naechste, text_version: worte.textVersion }).catch(rejectedWrite(router));

      if (result.success) appToast.success(WAHL_GESPEICHERT);
      else appToast.failure(WAHL_NICHT_GESPEICHERT, result);
    });
  };

  const { umfang } = worte;

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
            selectedKeys={wahl.umfang === undefined ? [] : [wahl.umfang]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              const gewaehlt = UMFANG_REIHENFOLGE.find((option) => option === picked);
              if (gewaehlt !== undefined && gewaehlt !== wahl.umfang) waehle({ ...wahl, umfang: gewaehlt });
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
                  aria-describedby={geschlossen ? widerrufId : undefined}
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

      <div className="flex w-full flex-col gap-y-3">
        {/* Offered while the stored record holds it on, whatever may be granted: a withdrawal stands open
            on every record. The stored record, never the pressed value, so a switch just turned off keeps
            the focus until the page is read again. */}
        {((erteilbar && medienAngeboten) || gespeichert.medien) && (
          <Switch
            className="flex w-full flex-col gap-y-1"
            aria-describedby={medienAbsatzId}
            isSelected={wahl.medien}
            onChange={(medien) => waehle({ ...wahl, medien: medien })}>
            <Switch.Content className={panel.switchContent()}>
              {worte.medien.schalter}
              <Switch.Control className={panel.switchControl()}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        )}
        <p
          id={medienAbsatzId}
          className={ABSATZ_CLASSES}>
          {worte.medien.absatz}
        </p>
      </div>

      <p
        id={widerrufId}
        className={ABSATZ_CLASSES}>
        {worte.widerruf}
      </p>
    </div>
  );
}
