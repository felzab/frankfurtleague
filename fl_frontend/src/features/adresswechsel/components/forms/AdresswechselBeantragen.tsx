"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { asSignInIdentifier } from "@/core/emailAddress";
import { beantrageAdresswechselAction } from "@/features/adresswechsel/actions";
import { AdresswechselGrundSchema, FLAdresswechselVerwaltungPayloadSchema } from "@/features/adresswechsel/schemas";
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
import { LINK_UNKLAR } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";
import { meldeAdresswechselVersand } from "@/shared/utils/linkVersandToast";
import { pressLinkWrite } from "@/shared/utils/linkWrite";
import { toFieldErrors } from "@/shared/utils/validation";

import type { Key } from "@heroui/react/rac";

export const LINK_AN_NEUE_ADRESSE = "Link an neue Adresse senden";

/**
 * The reload first, then the address shown again, which a reload empties: a second start
 * replaces one that landed, so entering it again is safe either way.
 */
const START_OHNE_ANTWORT =
  "Prüfe die Verbindung, lade die Seite neu und zeige die bisherige Adresse erneut an. Steht dort keine Änderung, trage die neue Adresse erneut ein.";

/** The two ways an administrator starts a change: the address on file asked first, or a recorded reason and a waiting time. */
type Weg = "fragen" | "unerreichbar";

const WEGE: readonly { id: Weg; label: string }[] = [
  { id: "fragen", label: "Die bisherige Adresse fragen" },
  { id: "unerreichbar", label: "Die bisherige Adresse ist nicht mehr erreichbar" },
];

/** Names the way chips for a screen reader, `ToggleButtonGroup` carrying its own role and no label element. */
const WEG_LABEL_ID = "adresswechsel-weg";

/**
 * The box's typing, held by the tool above every read it makes, so a read answering after a write keeps the way and
 * the reason: a way reset to its default would start a change asking the lost mailbox.
 */
export type AdresswechselEntwurf = { email: string; weg: Weg; grund: string };

export const LEERER_ENTWURF: AdresswechselEntwurf = { email: "", weg: "fragen", grund: "" };

/** The reason is sent only on the way that records one: the address on file is asked first exactly where it is null. */
const gesendeterGrund = ({ weg, grund }: AdresswechselEntwurf): string | null => (weg === "unerreichbar" ? grund : null);

type Fehler = { email?: string; grund?: string };

/** The box's two values as the write's own schema judges them, at the press and never between keystrokes. */
function fehlerIn(adresse: string, entwurf: AdresswechselEntwurf): Fehler {
  const geprueft = FLAdresswechselVerwaltungPayloadSchema.safeParse({
    adresse: adresse,
    email: entwurf.email,
    grund: gesendeterGrund(entwurf),
  });
  if (geprueft.success) return {};
  const fehler = toFieldErrors(geprueft.error);
  return { email: fehler.email, grund: fehler.grund };
}

/** The reason required on its way, so its box wears the star its refusal asks for: the payload's own field is nullable. */
const MIT_GRUND = FLAdresswechselVerwaltungPayloadSchema.extend({ grund: AdresswechselGrundSchema });

/**
 * Whether the box holds an address its press would send: compared as the backend compares it, both sides on the
 * sign-in fold.
 */
const istAndereAdresse = (entwurf: string, gespeicherteAdresse: string): boolean =>
  entwurf.trim() !== "" && asSignInIdentifier(entwurf) !== asSignInIdentifier(gespeicherteAdresse);

// `fl_frontend/src/features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx :: AdresseKorrigieren`'s box,
// without its `<Form>`: Enter is taken here, the press being one write of its own.
/** The administrator's start of a change for the address the tool read. */
export function AdresswechselBeantragen({
  adresse,
  entwurf,
  ersetztOffen,
  fokussieren,
  onEntwurfChange,
  onGeschrieben,
  onAbbrechen,
}: {
  /** The address on file, folded as the read answered it: what the start names, never a second typing of it. */
  adresse: string;
  entwurf: AdresswechselEntwurf;
  /** Whether a change already stands at the address, which this start ends. */
  ersetztOffen: boolean;
  fokussieren: boolean;
  onEntwurfChange: (next: AdresswechselEntwurf) => void;
  onGeschrieben: () => void;
  onAbbrechen: () => void;
}) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [fehler, setFehler] = useState<{ satz: Fehler; zu: AdresswechselEntwurf } | null>(null);
  const [sendet, setSendet] = useState(false);
  const feldRef = useRef<HTMLInputElement>(null);

  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the control
  // that opened this box unmounts with the press, leaving a keyboard user on the document body.
  useEffect(() => {
    if (fokussieren) feldRef.current?.focus();
  }, [fokussieren]);

  const unveraendert = !istAndereAdresse(entwurf.email, adresse);

  const markiere = (satz: Fehler) => {
    setFehler({ satz: satz, zu: entwurf });
    feldRef.current?.focus();
  };

  const sende = async () => {
    // The pending button is not the whole guard: Enter in the field presses too.
    if (sendet || unveraendert) return;
    const satz = fehlerIn(adresse, entwurf);
    if (satz.email !== undefined || satz.grund !== undefined) {
      markiere(satz);
      return;
    }

    const landing = focusAfterWrite();
    // Ends the change standing at the address on file, its links with it.
    const res = await pressLinkWrite({
      isDirty: false,
      stepUp,
      router,
      pending: setSendet,
      write: () => beantrageAdresswechselAction({ adresse: adresse, email: entwurf.email, grund: gesendeterGrund(entwurf) }),
      repair: START_OHNE_ANTWORT,
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

    landing.landed();
    onGeschrieben();
    // The start owed its mails, which leave behind the answer: whether each arrives is the change's own read.
    meldeAdresswechselVersand({ versand: res.link ? "gesendet" : null, hinweis: "gesendet" }, res.message);
  };

  // A refusal is kept with the value it was about and retracted by a keystroke away from it.
  const gezeigt = fehler !== null && fehler.zu.email === entwurf.email ? (fehler.satz.email ?? null) : null;
  const grundGezeigt = fehler !== null && fehler.zu.grund === entwurf.grund ? (fehler.satz.grund ?? null) : null;
  const setze = (teil: Partial<AdresswechselEntwurf>) => onEntwurfChange({ ...entwurf, ...teil });

  return (
    <div className={`${PANEL_REVEAL_CLASSES} flex w-full flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm`}>
      {/* Said before the press rather than after it: the start ends the change shown above, its links with it. */}
      {ersetztOffen && (
        <p className="muted-hint text-pretty">Eine neue Änderung beendet die oben gezeigte, und ihre Links gelten nicht mehr.</p>
      )}

      <RequiredSchemas schemas={[entwurf.weg === "unerreichbar" ? MIT_GRUND : FLAdresswechselVerwaltungPayloadSchema]}>
        <TextField
          type="email"
          name="email"
          value={entwurf.email}
          isInvalid={gezeigt !== null}
          onChange={(email) => setze({ email })}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void sende();
          }}
          className="w-full sm:max-w-md">
          {/* Not „E-Mail“: the address on file stands above, so the reader sees old over new. */}
          <Label className={FIELD_LABEL_CLASSES}>Neue E-Mail-Adresse</Label>
          <Input
            ref={feldRef}
            autoComplete="off"
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
            selectedKeys={[entwurf.weg]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              if (picked === "fragen" || picked === "unerreichbar") setze({ weg: picked });
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

        {entwurf.weg === "unerreichbar" && (
          <TextField
            name="grund"
            value={entwurf.grund}
            isInvalid={grundGezeigt !== null}
            onChange={(grund) => setze({ grund })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void sende();
            }}
            className="w-full">
            <Label className={FIELD_LABEL_CLASSES}>Grund</Label>
            <Input
              autoComplete="off"
              placeholder="z.B. Postfach von der Schule gelöscht, bestätigt durch die Ansprechperson des Teams"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES}>{grundGezeigt}</FieldError>
            {/* Kept a year in the log once the change takes effect, past any redaction: the backend refuses a name of the
                person in it. A change ending without effect takes it out of the log. */}
            <Hint
              mode="field"
              text="Wie Du geprüft hast, wer fragt. Nenne hier keine Person beim Namen und keine Adresse. Gilt die Änderung, steht der Grund zwölf Monate im Änderungsprotokoll. Endet sie vorher, wird er gelöscht."
            />
          </TextField>
        )}
      </RequiredSchemas>

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        {/* On the control, never a sentence beside it that the first keystroke would unmount.
            `sendet` is left out: it ends by itself. */}
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
          onPress={onAbbrechen}
          className={formButton({ intent: "cancel", stacks: true })}>
          Abbrechen
        </Button>
        <StepUpRefused refused={stepUp.refused} />
      </div>
    </div>
  );
}
