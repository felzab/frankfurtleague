"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Pencil from "@gravity-ui/icons/Pencil";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { asSignInIdentifier } from "@/core/emailAddress";
import { beantrageSpielerAdresswechselAction } from "@/features/spieler/actions";
import { ADRESSE_AENDERN } from "@/features/spieler/constants";
import { FLSpielerAdresswechselPayloadSchema } from "@/features/spieler/schemas";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PANEL_REVEAL_CLASSES } from "@/shared/components/ui/motion";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { RequiredSchemas } from "@/shared/components/ui/RequiredMarks";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { TextField } from "@/shared/components/ui/TextField";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT, LINK_UNKLAR } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";
import { pressLinkWrite } from "@/shared/utils/linkWrite";
import { toFieldErrors } from "@/shared/utils/validation";

const LINK_AN_NEUE_ADRESSE = "Link an neue Adresse senden";

/** A refusal and the value it was about: a keystroke away from that value retracts it, and nothing else does. */
type Fehler = { satz: string; zu: string };

/**
 * Whether the box holds an address its press would send, which is also what the editor counts as unsaved:
 * compared as the backend compares it (`REQ-SPIELER-007`), both sides on the sign-in fold.
 */
export const istAndereAdresse = (entwurf: string, gespeicherteAdresse: string): boolean =>
  entwurf.trim() !== "" && asSignInIdentifier(entwurf) !== asSignInIdentifier(gespeicherteAdresse);

/** The schema's own sentence for the box, or `null` where it takes the value. */
const urteil = (spielerId: string, email: string): string | null => {
  const geprueft = FLSpielerAdresswechselPayloadSchema.safeParse({ id: spielerId, email: email });
  return geprueft.success ? null : (toFieldErrors(geprueft.error).email ?? null);
};

/**
 * Behind „Adresse ändern“, the request for a new sign-in address. The save bar never carries one:
 * **the stored address stays in force until the new mailbox confirms its link**, so this press is
 * the only way in.
 */
export function FormAdresseSection({
  spielerId,
  email,
  isDirty,
  entwurf,
  onEntwurfChange,
}: {
  spielerId: string;
  /** The stored, folded address, `null` for a pupil holding none, who takes no change. */
  email: string | null;
  /** The editor's unsaved typing, which the write re-keys the editor over. */
  isDirty: boolean;
  /** The box's typing, `null` while it is closed. Held above the editor's key, so a save's refresh keeps it. */
  entwurf: string | null;
  onEntwurfChange: (next: string | null) => void;
}) {
  // Set by the press alone: a box the refresh remounts open takes no focus from wherever the reader is.
  const [perDruck, setPerDruck] = useState(false);
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="E-Mail-Adresse">
          <Hint
            mode="reveal"
            label="Hinweis zur E-Mail-Adresse"
            body={{
              lead: "Mit dieser Adresse meldet sich die Spielerin oder der Spieler an. Eine neue gilt erst, wenn sie über den Link bestätigt ist, den wir an sie schicken. Bis dahin bleibt die hinterlegte in Kraft.",
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Hinterlegte Adresse">{email ?? <Leer />}</Angabe>
        </dl>

        {email === null ? (
          // The missing control in the same breath, as the consent panel beside it says its own: a reader
          // meeting an empty value among editable panels goes looking for the way to enter one.
          <p className="muted-hint">Eine Adresse kommt mit der Registrierung über den Link des Teams.</p>
        ) : (
          <FocusSlot name="adresse-aendern">
            {entwurf !== null ? (
              <AdresseAendern
                spielerId={spielerId}
                gespeicherteAdresse={email}
                isDirty={isDirty}
                entwurf={entwurf}
                fokussieren={perDruck}
                onEntwurfChange={onEntwurfChange}
                onFertig={() => onEntwurfChange(null)}
              />
            ) : (
              <div className="flex w-full flex-wrap items-start gap-2">
                <Button
                  type="button"
                  onPress={() => {
                    setPerDruck(true);
                    // Prefilled, because the commonest correction is one wrong character.
                    onEntwurfChange(email);
                  }}
                  className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                  <Pencil
                    className="size-3.5"
                    aria-hidden="true"
                  />
                  <span>{ADRESSE_AENDERN}</span>
                </Button>
              </div>
            )}
          </FocusSlot>
        )}
      </div>
    </section>
  );
}

/**
 * The box `fl_frontend/src/features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx ::
 * AdresseKorrigieren` opens, without its `<Form>`: this one stands inside the editor's, and a form may
 * hold no other. Enter is taken here for the same reason, or it would submit the editor's draft.
 */
function AdresseAendern({
  spielerId,
  gespeicherteAdresse,
  isDirty,
  entwurf,
  fokussieren,
  onEntwurfChange,
  onFertig,
}: {
  spielerId: string;
  gespeicherteAdresse: string;
  isDirty: boolean;
  entwurf: string;
  fokussieren: boolean;
  onEntwurfChange: (next: string) => void;
  onFertig: () => void;
}) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [fehler, setFehler] = useState<Fehler | null>(null);
  const [sendet, setSendet] = useState(false);
  const feldRef = useRef<HTMLInputElement>(null);

  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the control
  // that opened this box unmounts with the press, leaving a keyboard user on the document body.
  useEffect(() => {
    if (fokussieren) feldRef.current?.focus();
  }, [fokussieren]);

  const unveraendert = !istAndereAdresse(entwurf, gespeicherteAdresse);

  const markiere = (satz: string) => {
    setFehler({ satz: satz, zu: entwurf });
    feldRef.current?.focus();
  };

  const schliesse = (landing: ReturnType<typeof focusAfterWrite>) => {
    landing.landed();
    onFertig();
  };

  const sende = async () => {
    // The pending button is not the whole guard: Enter in the field presses too.
    if (sendet || unveraendert) return;
    const satz = urteil(spielerId, entwurf);
    if (satz !== null) {
      markiere(satz);
      return;
    }

    const landing = focusAfterWrite();
    // The link it mails replaces any the pupil's new address already holds (`docs/frontend/spec.md :: I432`).
    const res = await pressLinkWrite({
      isDirty,
      stepUp,
      router,
      pending: setSendet,
      write: () => beantrageSpielerAdresswechselAction({ id: spielerId, email: entwurf }),
      repair: LINK_ERNEUT_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      // A refusal of the address itself stands on the box, which is the way out; any other is the press's.
      const feld = res.fieldErrors?.email;
      if (feld !== undefined && res.outcome !== "unknown") {
        markiere(feld);
        return;
      }
      appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      return;
    }

    schliesse(landing);
    if (res.versandFehlgeschlagen === true) appToast.warning("Link nicht gesendet", { description: res.message });
    else appToast.success("Link gesendet", { description: res.message });
  };

  const gezeigt = fehler !== null && fehler.zu === entwurf ? fehler.satz : null;

  return (
    <div className={`${PANEL_REVEAL_CLASSES} flex w-full flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm`}>
      {/* The request's own payload, which the editor's save around it never submits. */}
      <RequiredSchemas schemas={[FLSpielerAdresswechselPayloadSchema]}>
        <TextField
          type="email"
          name="email"
          value={entwurf}
          isInvalid={gezeigt !== null}
          onChange={onEntwurfChange}
          onBlur={() => {
            // Missing is never a blur's business, and a value already refused keeps its refusal.
            if (entwurf.trim() === "" || gezeigt !== null) return;
            const satz = urteil(spielerId, entwurf);
            if (satz !== null) setFehler({ satz: satz, zu: entwurf });
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
