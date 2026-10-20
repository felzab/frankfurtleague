"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { ADRESSWECHSEL_WARTEZEIT_DAUER } from "@/core/adresswechsel";
import { asSignInIdentifier } from "@/core/emailAddress";
import { formButton } from "@/shared/components/ui/formButtons";
import {
  FIELD_ERROR_CLASSES,
  FIELD_INPUT_CLASSES,
  FIELD_LABEL_CLASSES,
  TOGGLE_GROUP_ALIGN_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { PANEL_REVEAL_CLASSES } from "@/shared/components/ui/motion";
import { OPTION_CHIP_CLASSES } from "@/shared/components/ui/optionChip";
import { RequiredSchemas } from "@/shared/components/ui/RequiredMarks";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { TextField } from "@/shared/components/ui/TextField";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT, LINK_UNKLAR } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";
import { meldeAdresswechselVersand } from "@/shared/utils/linkVersandToast";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import type { ActionResult } from "@/shared/types/types";
import type { HinweisVersand, LinkVersand } from "@/shared/utils/linkVersand";
import type { Key } from "@heroui/react/rac";
import type { ZodType } from "zod";

export const LINK_AN_NEUE_ADRESSE = "Link an neue Adresse senden";

/** The address hint, both editors alike: a person who can sign in changes it on their own account page. */
export const ADRESSE_HINWEIS = `Mit dieser Adresse meldet sich die Person an. Eine neue trägt sie selbst in ihrem Konto ein. Hier nur, wenn sie sich nicht mehr anmelden kann: Ohne Grund muss sie die neue mit ihrer bisherigen Adresse freigeben. Mit Grund gilt die neue erst ${ADRESSWECHSEL_WARTEZEIT_DAUER} nach ihrer Bestätigung.`;

/** The two ways an administrator starts a change: the address on file asked first, or a recorded reason and a waiting time. */
type Weg = "fragen" | "unerreichbar";

const WEGE: readonly { id: Weg; label: string }[] = [
  { id: "fragen", label: "Die bisherige Adresse fragen" },
  { id: "unerreichbar", label: "Die bisherige Adresse ist nicht mehr erreichbar" },
];

/** Names the way chips for a screen reader, `ToggleButtonGroup` carrying its own role and no label element. */
const WEG_LABEL_ID = "adresswechsel-weg";

/** The box's two refusable values; a refusal is kept with the value it was about and retracted by a keystroke away from it. */
export type AdresswechselFehler = { email?: string; grund?: string };

type Fehler = { satz: AdresswechselFehler; zu: { email: string; grund: string } };

/**
 * Whether the box holds an address its press would send, which is also what the editor counts as unsaved:
 * compared as the backend compares it, both sides on the sign-in fold.
 */
export const istAndereAdresse = (entwurf: string, gespeicherteAdresse: string): boolean =>
  entwurf.trim() !== "" && asSignInIdentifier(entwurf) !== asSignInIdentifier(gespeicherteAdresse);

// `fl_frontend/src/features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx :: AdresseKorrigieren`'s box,
// without its `<Form>`: this one stands inside the editor's, and Enter is taken here or it submits the draft.
/** The administrator's start of a change, both lanes' editors alike. */
export function AdresswechselBeantragen({
  gespeicherteAdresse,
  isDirty,
  entwurf,
  fokussieren,
  schema,
  pruefe,
  write,
  onEntwurfChange,
  onFertig,
}: {
  gespeicherteAdresse: string;
  isDirty: boolean;
  entwurf: string;
  fokussieren: boolean;
  /** The lane's payload schema, whose required marks the fields read. */
  schema: ZodType;
  /** The lane schema's own sentences for the two values, empty where it takes them. */
  pruefe: (email: string, grund: string | null) => AdresswechselFehler;
  write: (email: string, grund: string | null) => Promise<ActionResult<{ versand: LinkVersand | null; hinweis: HinweisVersand | null }>>;
  onEntwurfChange: (next: string) => void;
  onFertig: () => void;
}) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [weg, setWeg] = useState<Weg>("fragen");
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<Fehler | null>(null);
  const [sendet, setSendet] = useState(false);
  const feldRef = useRef<HTMLInputElement>(null);

  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the control
  // that opened this box unmounts with the press, leaving a keyboard user on the document body.
  useEffect(() => {
    if (fokussieren) feldRef.current?.focus();
  }, [fokussieren]);

  const unveraendert = !istAndereAdresse(entwurf, gespeicherteAdresse);
  // The reason is sent only on the way that records one: an empty box there is the schema's to refuse.
  const gesendeterGrund = weg === "unerreichbar" ? grund : null;

  const markiere = (satz: AdresswechselFehler) => {
    setFehler({ satz: satz, zu: { email: entwurf, grund: grund } });
    feldRef.current?.focus();
  };

  const schliesse = (landing: ReturnType<typeof focusAfterWrite>) => {
    landing.landed();
    onFertig();
  };

  const sende = async () => {
    // The pending button is not the whole guard: Enter in the field presses too.
    if (sendet || unveraendert) return;
    const satz = pruefe(entwurf, gesendeterGrund);
    if (satz.email !== undefined || satz.grund !== undefined) {
      markiere(satz);
      return;
    }

    const landing = focusAfterWrite();
    // The link it mails replaces any the new address already holds (`docs/frontend/spec.md :: I432`).
    const res = await pressLinkWrite({
      isDirty,
      stepUp,
      router,
      pending: setSendet,
      write: () => write(entwurf, gesendeterGrund),
      repair: LINK_ERNEUT_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      // A refusal of either value stands on its box, which is the way out; any other is the press's.
      const feld = { email: res.fieldErrors?.email, grund: res.fieldErrors?.grund };
      if ((feld.email !== undefined || feld.grund !== undefined) && res.outcome !== "unknown") {
        markiere(feld);
        return;
      }
      appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      return;
    }

    schliesse(landing);
    meldeAdresswechselVersand(res, res.message);
  };

  const gezeigt = fehler !== null && fehler.zu.email === entwurf ? (fehler.satz.email ?? null) : null;
  const grundGezeigt = fehler !== null && fehler.zu.grund === grund ? (fehler.satz.grund ?? null) : null;

  return (
    <div className={`${PANEL_REVEAL_CLASSES} flex w-full flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm`}>
      {/* The start's own payload, which the editor's save around it never submits. */}
      <RequiredSchemas schemas={[schema]}>
        <TextField
          type="email"
          name="email"
          value={entwurf}
          isInvalid={gezeigt !== null}
          onChange={onEntwurfChange}
          onBlur={() => {
            // Missing is never a blur's business, and a value already refused keeps its refusal.
            if (entwurf.trim() === "" || gezeigt !== null) return;
            const satz = pruefe(entwurf, null).email;
            if (satz !== undefined) setFehler({ satz: { email: satz }, zu: { email: entwurf, grund: grund } });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void sende();
          }}
          className="w-full sm:max-w-md">
          {/* Not „E-Mail“: the stored address stands above, so the reader sees old over new. */}
          <Label className={FIELD_LABEL_CLASSES}>Neue E-Mail-Adresse</Label>
          <Input
            ref={feldRef}
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES}>{gezeigt}</FieldError>
        </TextField>

        <div className="flex w-full flex-col gap-y-1">
          <span
            id={WEG_LABEL_ID}
            className={FIELD_LABEL_CLASSES}>
            Weg
          </span>
          <ToggleButtonGroup
            aria-labelledby={WEG_LABEL_ID}
            size="sm"
            isDetached
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[weg]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              if (picked === "fragen" || picked === "unerreichbar") setWeg(picked);
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
            {WEGE.map((option) => (
              <ToggleButton
                key={option.id}
                id={option.id}
                className={OPTION_CHIP_CLASSES}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

        {weg === "unerreichbar" && (
          <TextField
            name="grund"
            value={grund}
            isInvalid={grundGezeigt !== null}
            onChange={setGrund}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void sende();
            }}
            className="w-full">
            <Label className={FIELD_LABEL_CLASSES}>Grund</Label>
            <Input
              autoComplete="off"
              placeholder="z.B. Postfach von der Schule gelöscht, bestätigt durch die Ansprechperson des Teams am 21.10.2026"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES}>{grundGezeigt}</FieldError>
            {/* Kept a year in the log, past any redaction: the backend refuses a name of the person in it. */}
            <Hint
              mode="field"
              text="Wie Du geprüft hast, wer fragt. Nenne hier keine Person beim Namen und keine Adresse. Der Grund steht zwölf Monate im Änderungsprotokoll."
            />
          </TextField>
        )}
      </RequiredSchemas>

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        {/* On the control, never a sentence beside it that the first keystroke would unmount
            (`docs/frontend/spec.md` §1.14). `sendet` is left out: it ends by itself. */}
        <Hint
          mode="refusal"
          reason={!sendet && unveraendert ? "Gib zuerst eine andere E-Mail-Adresse ein." : null}
          label={LINK_AN_NEUE_ADRESSE}>
          <Button
            type="button"
            variant="primary"
            isPending={sendet}
            isDisabled={!sendet && unveraendert}
            onPress={() => void sende()}
            className={formButton({ intent: "submit", stacks: true })}>
            {sendet ? stepUp.running("Sendet...") : LINK_AN_NEUE_ADRESSE}
          </Button>
        </Hint>
        {/* Held while the write runs: a press that unmounts this box mid-write drops the toast naming the outcome. */}
        <Button
          type="button"
          variant="secondary"
          isPending={sendet}
          onPress={() => schliesse(focusAfterWrite())}
          className={formButton({ intent: "cancel", stacks: true })}>
          Abbrechen
        </Button>
        <StepUpRefused refused={stepUp.refused} />
      </div>
    </div>
  );
}
