"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Pencil from "@gravity-ui/icons/Pencil";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { ADRESSWECHSEL_WARTEZEIT_DAUER, adresswechselZeitpunkt } from "@/core/adresswechsel";
import { ADRESSWECHSEL_STOPPEN } from "@/core/adresswechselAntworten";
import { LINK_AN_NEUE_ADRESSE } from "@/features/konto/components/forms/AdresswechselBeantragen";
import { gibAdresswechselFreiAction, starteAdresswechselAction, stoppeAdresswechselAction } from "@/features/konto/personActions";
import { FLKontoAdresswechselPayloadSchema } from "@/features/konto/schemas";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { IDENTITY_CONFIRMATION_TITLE, IdentityConfirmation } from "@/shared/components/ui/IdentityConfirmation";
import { ModalShell } from "@/shared/components/ui/ModalShell";
import { PANEL_REVEAL_CLASSES } from "@/shared/components/ui/motion";
import { RequiredSchemas } from "@/shared/components/ui/RequiredMarks";
import { TextField } from "@/shared/components/ui/TextField";
import { useConfirmationWindows } from "@/shared/hooks/useConfirmationWindows";
import { LINK_UNKLAR, unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { meldeLinkVersand } from "@/shared/utils/linkVersandToast";
import { toFieldErrors } from "@/shared/utils/validation";

import { pruefeInhaberAction } from "../../../actions";
import { CodeConfirmation } from "../../ui/CodeConfirmation";

import type { FLKontoAdresswechselOffen, FLKontoAdresswechselResponse } from "@/features/konto/schemas";
import type { ConfirmedUntil } from "@/shared/hooks/useConfirmationWindows";
import type { ActionFailure } from "@/shared/types/types";
import type { VersandTitel } from "@/shared/utils/linkVersandToast";

/** The press opening the box: „E-Mail-“ because this panel also lists the passkeys' and sign-ins' neighbours. */
export const E_MAIL_ADRESSE_AENDERN = "E-Mail-Adresse ändern";
export const AENDERUNG_FREIGEBEN = "Änderung freigeben";
export const AENDERUNG_ZURUECKZIEHEN = "Änderung zurückziehen";

/** Why the page asks before a start or an approval, said beside the control that asks. */
const STEP_UP_HINT = "Für eine neue Adresse fragen wir kurz nach, ob Du es bist.";

/** The account page's link titles, in the words its deletion link's press uses. */
const KONTO_LINK_TITEL: VersandTitel = {
  gesendet: "Link verschickt",
  fehlgeschlagen: "Link nicht verschickt",
  abgelegt: "Link zurückgehalten",
};

/** What the confirmation waits for: a start with its address, or the approval. */
type Wartend = { art: "start"; email: string } | { art: "freigabe" };

/** The spine's refusal for want of a recent sign-in, which the page answers by asking rather than by a toast. */
const wantsStepUp = (result: { success: boolean }): result is ActionFailure & { stepUp: true } =>
  !result.success && Reflect.get(result, "stepUp") === true;

/** What the panel asks a confirmation with, read on the server off the session the page was drawn for. */
export type AdresswechselBestaetigung = ConfirmedUntil & {
  readonly hasPasskey: boolean;
  /** An administrator's address, whose confirmation is a passkey's alone (`docs/frontend/spec.md :: I422`). */
  readonly verwaltung: boolean;
  readonly inhaberId: string;
  readonly inhaberAdresse: string;
};

/** The pending change's sentence, by the step it waits on; the pending address is never shown. */
function offenSatz(offen: FLKontoAdresswechselOffen): string {
  const bis = offen.gueltig_bis === null ? null : adresswechselZeitpunkt(offen.gueltig_bis);

  if (offen.wartet_auf === "freigabe") {
    return `Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen. Sie gilt erst, wenn Du sie hier freigibst und sie danach über ihren Link bestätigt wird. Gib sie nur frei, wenn Du das selbst bei uns angefragt hast.${bis === null ? "" : ` Freigeben kannst Du bis ${bis}.`}`;
  }
  if (offen.wartet_auf === "wartezeit") {
    const ab = offen.wirksam_ab === null ? "" : ` und gilt ab ${adresswechselZeitpunkt(offen.wirksam_ab)}`;
    return `Die neue E-Mail-Adresse ist bestätigt${ab}. Bis dahin gilt diese. Stimmt das nicht, stoppe die Änderung.`;
  }
  if (offen.weg === "wartezeit") {
    return `Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen, weil Deine bisherige nicht mehr erreichbar sein soll. Bestätigt sie ihren Link, gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} danach. Stimmt das nicht, stoppe die Änderung.`;
  }
  return `Eine neue E-Mail-Adresse wartet auf ihre Bestätigung${bis === null ? "" : `, bis ${bis}`}. Bis dahin gilt diese.`;
}

/**
 * The address control of the account page's „Anmeldung“ panel: the person's own start, and the pending
 * change's approval and stop. A start or an approval hands the records over, so each asks a passkey or a
 * code to the address on file first, inside the enrolment window (`docs/frontend/spec.md :: I411`); the
 * stop hands nothing over and asks nothing.
 */
export function AdresswechselPanel({
  adresswechsel,
  bestaetigung,
}: {
  adresswechsel: FLKontoAdresswechselResponse;
  bestaetigung: AdresswechselBestaetigung;
}) {
  const router = useRouter();
  const windows = useConfirmationWindows(bestaetigung);
  const [entwurf, setEntwurf] = useState<string | null>(null);
  const [fehler, setFehler] = useState<{ satz: string; zu: string } | null>(null);
  const [laeuft, setLaeuft] = useState<"start" | "freigabe" | "stopp" | null>(null);
  const [wartend, setWartend] = useState<Wartend | null>(null);
  const feldRef = useRef<HTMLInputElement>(null);
  const { offen } = adresswechsel;

  const istInhaber = async (): Promise<boolean> => {
    const answer = await pruefeInhaberAction(bestaetigung.inhaberId);
    return answer.success && answer.gleich;
  };

  const sende = async (was: Wartend): Promise<void> => {
    setLaeuft(was.art);
    // A rejected action may still have mailed, and uncaught here it takes the page down with it.
    const res = await (was.art === "start" ? starteAdresswechselAction({ email: was.email }) : gibAdresswechselFreiAction()).catch(
      unansweredAction,
    );
    setLaeuft(null);

    if (wantsStepUp(res)) {
      // Whatever the page knew of the window is forgotten: the server wants a confirmation first.
      windows.close("enrolment");
      setWartend(was);
      return;
    }
    if (!res.success) {
      const feld = res.fieldErrors?.email;
      if (was.art === "start" && feld !== undefined && res.outcome !== "unknown") {
        setFehler({ satz: feld, zu: was.email });
        feldRef.current?.focus();
        return;
      }
      if (was.art === "start") appToast.failure("Link nicht verschickt", res, LINK_UNKLAR);
      else appToast.failure("Nicht freigegeben", res, LINK_UNKLAR);
      return;
    }

    if (was.art === "start") setEntwurf(null);
    meldeLinkVersand(
      res.versand,
      was.art === "start" ? KONTO_LINK_TITEL : { ...KONTO_LINK_TITEL, gesendet: "Änderung freigegeben" },
      res.message,
    );
  };

  /** Runs `was` now inside the window, and after the confirmation otherwise. */
  const mitBestaetigung = (was: Wartend): void => {
    if (windows.isStale(Date.now(), "enrolment")) {
      setWartend(was);
      return;
    }
    void sende(was);
  };

  const bestaetigt = (): void => {
    const was = wartend;
    setWartend(null);
    windows.confirmed();
    // The confirmation minted a new session and ended this page's: what the page drew off the old one is read again.
    router.refresh();
    if (was !== null) void sende(was);
  };

  const starte = (): void => {
    if (entwurf === null || laeuft !== null) return;
    const geprueft = FLKontoAdresswechselPayloadSchema.safeParse({ email: entwurf });
    if (!geprueft.success) {
      setFehler({ satz: toFieldErrors(geprueft.error).email ?? "", zu: entwurf });
      feldRef.current?.focus();
      return;
    }
    mitBestaetigung({ art: "start", email: entwurf });
  };

  const stoppe = async (): Promise<void> => {
    setLaeuft("stopp");
    const res = await stoppeAdresswechselAction().catch(unansweredAction);
    setLaeuft(null);

    if (res.success) appToast.success("Änderung gestoppt", { description: res.message });
    else appToast.failure("Änderung nicht gestoppt", res);
  };

  const gezeigt = fehler !== null && fehler.zu === entwurf ? fehler.satz : null;
  // The person's own start is theirs to take back; a change somebody else asked for is stopped.
  const stoppName = offen?.weg === "konto" ? AENDERUNG_ZURUECKZIEHEN : ADRESSWECHSEL_STOPPEN;

  return (
    <div className="flex flex-col gap-4">
      {offen === null ? (
        <>
          <p className="muted-hint text-pretty">
            Mit dieser Adresse meldest Du Dich an, und unter ihr stehen Deine Einträge. Eine neue gilt erst, wenn Du sie über den Link
            bestätigst, den wir an sie schicken. Bis dahin bleibt diese in Kraft.
          </p>
          {adresswechsel.bleibt_verwaltung && (
            <p className="muted-hint text-pretty">Dein Zugang zur Verwaltung bleibt bei der bisherigen Adresse.</p>
          )}

          {entwurf === null ? (
            <div className="flex w-full flex-wrap items-start gap-2">
              <Button
                type="button"
                onPress={() => setEntwurf("")}
                className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                <Pencil
                  className="size-3.5"
                  aria-hidden="true"
                />
                <span>{E_MAIL_ADRESSE_AENDERN}</span>
              </Button>
            </div>
          ) : (
            <div className={`${PANEL_REVEAL_CLASSES} flex w-full flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm`}>
              <RequiredSchemas schemas={[FLKontoAdresswechselPayloadSchema]}>
                <TextField
                  type="email"
                  name="email"
                  value={entwurf}
                  isInvalid={gezeigt !== null}
                  onChange={setEntwurf}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    starte();
                  }}
                  className="w-full sm:max-w-md">
                  <Label className={FIELD_LABEL_CLASSES}>Neue E-Mail-Adresse</Label>
                  <Input
                    ref={feldRef}
                    autoComplete="email"
                    placeholder="z.B. name@beispiel.de"
                    className={FIELD_INPUT_CLASSES}
                  />
                  <FieldError className={FIELD_ERROR_CLASSES}>{gezeigt}</FieldError>
                </TextField>
              </RequiredSchemas>
              <p className="muted-hint text-pretty">{STEP_UP_HINT}</p>
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="primary"
                  isPending={laeuft === "start"}
                  isDisabled={entwurf.trim() === ""}
                  onPress={starte}
                  className={formButton({ intent: "submit", stacks: true })}>
                  {laeuft === "start" ? "Sendet..." : LINK_AN_NEUE_ADRESSE}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  isPending={laeuft === "start"}
                  onPress={() => setEntwurf(null)}
                  className={formButton({ intent: "cancel", stacks: true })}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="fluid-sm text-pretty text-foreground">{offenSatz(offen)}</p>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
            {offen.wartet_auf === "freigabe" && (
              <Button
                type="button"
                variant="primary"
                isPending={laeuft === "freigabe"}
                isDisabled={laeuft !== null}
                onPress={() => mitBestaetigung({ art: "freigabe" })}
                className={formButton({ intent: "submit", stacks: true })}>
                {AENDERUNG_FREIGEBEN}
              </Button>
            )}
            <Button
              type="button"
              isPending={laeuft === "stopp"}
              isDisabled={laeuft !== null}
              onPress={() => void stoppe()}
              className={formButton({ intent: "destructive", stacks: true })}>
              {stoppName}
            </Button>
          </div>
          {offen.wartet_auf === "freigabe" && <p className="muted-hint text-pretty">{STEP_UP_HINT}</p>}
        </>
      )}

      <ModalShell
        isOpen={wartend !== null}
        onClose={() => setWartend(null)}
        heading={IDENTITY_CONFIRMATION_TITLE}
        size="confirm">
        <IdentityConfirmation
          hinweis={STEP_UP_HINT}
          hasPasskey={bestaetigung.hasPasskey}
          codeHalf={
            // A code goes to the address on file, which is the holder the change asks (`docs/frontend/spec.md :: I422`).
            bestaetigung.verwaltung ? null : (
              <CodeConfirmation
                address={bestaetigung.inhaberAdresse}
                istInhaber={istInhaber}
                onConfirmed={bestaetigt}
              />
            )
          }
          istInhaber={istInhaber}
          onConfirmed={bestaetigt}
        />
      </ModalShell>
    </div>
  );
}
