"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Plus from "@gravity-ui/icons/Plus";

import { Button } from "@heroui/react/button";

import { authClient } from "@/core/authClient";
import { readPasskeyStandAction, removePasskeyAction, renamePasskeyAction } from "@/features/passkeys/actions";
import { LETZTER_PASSKEY, PasskeyKarteView } from "@/features/passkeys/components/ui/PasskeyKarteView";
import { Callout } from "@/shared/components/ui/Callout";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { IDENTITY_CONFIRMATION_TITLE, IdentityConfirmation } from "@/shared/components/ui/IdentityConfirmation";
import { ModalShell } from "@/shared/components/ui/ModalShell";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { STEP_UP_LABEL, STEP_UP_RUNNING } from "@/shared/components/ui/stepUp";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useConfirmationWindows } from "@/shared/hooks/useConfirmationWindows";
import { usePasskeyStepUp } from "@/shared/hooks/usePasskeyStepUp";
import { SPEICHERUNG_UNKLAR, unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { FOCUS_HEADING, focusAfterWrite, focusSection, focusSlot } from "@/shared/utils/focusAfterWrite";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import { endAndereAnmeldungenAction, endAnmeldungAction, pruefeInhaberAction } from "../../actions";
import { AndereAbmelden } from "../ui/AndereAbmelden";
import { AnmeldungZeile } from "../ui/AnmeldungZeile";
import { CodeConfirmation } from "../ui/CodeConfirmation";

import type { ActionFailure } from "@/shared/types/types";
import type { Sicherheit } from "../../types";

/** Why the page asks before a change, said on the panel that asks and under the control that asks. */
const STEP_UP_HINT = "Für Änderungen an Passkeys und Anmeldungen fragen wir kurz nach.";

/** The cap's own sentence, which names the way forward rather than the number it refuses at. */
const ZU_VIELE = "Mehr Passkeys gehen nicht. Lösche zuerst einen.";

/** The place the confirmation and the add control it opens share, so a landed confirmation hands the focus on. */
const HINZUFUEGEN = "hinzufuegen";

/** Where the sign-in page is: a removal of the passkey this device signed in with ends the page's own session. */
const SIGN_IN = "/signin";

/** A change the page runs, which answers whether it still needs a confirmation the page did not get. */
type Aenderung = () => Promise<"erledigt" | "stepUp">;

/** Why an enrolment did not happen; `stale` where the server wants a confirmation first. */
type EnrolmentHeld = Pick<ActionFailure, "error" | "outcome"> & { readonly stale?: true };

/** The spine's refusal for want of a recent sign-in; its type lives server-side, beside the session it judges. */
type StepUpRefusalAnswer = ActionFailure & { readonly stepUp: true };

/** An action's refusal for want of a recent sign-in, which the page answers by asking rather than by a toast. */
const wantsStepUp = (result: { success: boolean }): result is StepUpRefusalAnswer => !result.success && Reflect.get(result, "stepUp") === true;

/**
 * The „Sicherheit“ section: the passkeys, the sign-ins, and the one confirmation every change on it
 * passes (`docs/frontend/spec.md :: I422`).
 */
export function SicherheitPanel({ sicherheit }: { sicherheit: Sicherheit }) {
  const router = useRouter();
  const panel = formPanel();
  const { passkeys, anmeldungen, verwaltung } = sicherheit;

  const windows = useConfirmationWindows(sicherheit);
  const { close } = windows;
  const { enrolmentUntil } = windows.until;
  const [wartend, setWartend] = useState<Aenderung | null>(null);
  const [istBeschaeftigt, setIstBeschaeftigt] = useState(false);

  // The add control reads its label off the enrolment window, so its end redraws the control without a
  // press; the administrator's controls judge theirs at the press and need no timer.
  useEffect(() => {
    if (enrolmentUntil === null) return;
    const lapse = setTimeout(() => close("enrolment"), Math.max(0, enrolmentUntil - Date.now()));
    return () => clearTimeout(lapse);
  }, [enrolmentUntil, close]);

  const istInhaber = async (): Promise<boolean> => {
    const answer = await pruefeInhaberAction(sicherheit.inhaberId);
    return answer.success && answer.gleich;
  };

  const confirmed = (): void => {
    windows.confirmed();
    // The confirmation minted a new session and ended this page's: what the page drew off the old one,
    // „Dieses Gerät“ among it, is read again.
    router.refresh();
  };

  /** Runs `change` now if the page's session counts as confirmed, and after the panel's confirmation otherwise. */
  const withStepUp = async (change: Aenderung): Promise<void> => {
    if (!windows.isStale(Date.now()) && (await change()) === "erledigt") return;
    // Whatever the page knew of either window is forgotten: the server wants a confirmation first.
    close();
    setWartend(() => change);
  };

  const steppedUp = (): void => {
    const change = wartend;
    setWartend(null);
    confirmed();
    if (change !== null) void change();
  };

  // Each landing is read at the press: a confirmation the change waits for takes the focus into its dialog.
  const entferne = (id: string): Promise<void> => {
    const landing = focusAfterWrite();
    return withStepUp(async () => {
      // A rejected action may still have removed the row, and uncaught here it takes the page down with it.
      const result = await removePasskeyAction(id).catch(unansweredAction);
      if (wantsStepUp(result)) return "stepUp";

      if (!result.success) {
        appToast.failure("Passkey nicht gelöscht", result);
        return "erledigt";
      }

      appToast.success("Passkey gelöscht", { description: "Geräte, die damit angemeldet waren, wurden abgemeldet." });
      // The removal ended the session this page ran in: the sign-in page is where it can go on.
      if (result.diesesGeraet) router.replace(SIGN_IN);
      else landing.landed();
      return "erledigt";
    });
  };

  const benenne = (id: string, name: string, gelandet: () => void): Promise<void> =>
    withStepUp(async () => {
      const result = await renamePasskeyAction(id, name).catch(unansweredAction);
      if (wantsStepUp(result)) return "stepUp";

      if (result.success) {
        gelandet();
        appToast.success("Passkey umbenannt");
      } else {
        appToast.failure("Passkey nicht umbenannt", result);
      }
      return "erledigt";
    });

  const beende = (id: string): Promise<void> => {
    const landing = focusAfterWrite();
    return withStepUp(async () => {
      const result = await endAnmeldungAction(id).catch(unansweredAction);
      if (wantsStepUp(result)) return "stepUp";

      if (result.success) {
        landing.landed();
        appToast.success("Abgemeldet", { description: "Die Anmeldung ist beendet." });
      } else {
        appToast.failure("Nicht abgemeldet", result);
      }
      return "erledigt";
    });
  };

  const beendeAndere = (): Promise<void> => {
    const landing = focusAfterWrite();
    return withStepUp(async () => {
      const result = await endAndereAnmeldungenAction().catch(unansweredAction);
      if (wantsStepUp(result)) return "stepUp";

      if (result.success) {
        landing.landed();
        appToast.success("Alle anderen abgemeldet");
      } else {
        appToast.failure("Nicht abgemeldet", result);
      }
      return "erledigt";
    });
  };

  const hinzufuegenStepUp = usePasskeyStepUp(istInhaber);

  // The confirmation's control gives way to the add control it opens, in the place both stand in.
  const enrolmentConfirmed = (landing: ReturnType<typeof focusAfterWrite>): void => {
    landing.landed();
    confirmed();
  };

  const stepUpForEnrolment = async (): Promise<void> => {
    const landing = focusAfterWrite();
    if (await hinzufuegenStepUp.stepUp()) enrolmentConfirmed(landing);
  };

  const fuegeHinzu = async (): Promise<void> => {
    if (windows.isStale(Date.now(), "enrolment")) {
      close("enrolment");
      return;
    }
    // The first passkey moves the control under the list it starts.
    const landing = focusAfterWrite();
    setIstBeschaeftigt(true);
    const held = await enrolmentHeld();
    setIstBeschaeftigt(false);
    // The enrolment writes past every server action, so nothing refreshed the page for it.
    startTransition(() => router.refresh());

    if (held === null) {
      landing.landed();
      appToast.success("Passkey hinzugefügt", { description: "Du kannst Dich jetzt auch damit anmelden." });
      return;
    }
    if (held.stale === true) close("enrolment");
    appToast.failure("Passkey nicht hinzugefügt", held);
  };

  // One control, confirm first and then add, as a sudo prompt returns to its action: the browser opens
  // its own passkey prompt only on a fresh press, and the confirmation's prompt spent the first one.
  const hinzufuegen =
    sicherheit.kannHinzufuegen && enrolmentUntil === null ? (
      <div
        className="flex flex-col gap-2"
        {...focusSlot(HINZUFUEGEN)}>
        {passkeys.length > 0 && (
          <Button
            type="button"
            variant="primary"
            isPending={hinzufuegenStepUp.isPending}
            onPress={() => void stepUpForEnrolment()}
            className={formButton({ intent: "submit" })}>
            {hinzufuegenStepUp.isPending ? STEP_UP_RUNNING : STEP_UP_LABEL}
          </Button>
        )}
        <p className="muted-hint text-pretty">{STEP_UP_HINT}</p>
        <StepUpRefused refused={hinzufuegenStepUp.refused} />
        {/* A person's other way to a fresh sign-in, and their only one while they hold no passkey; an
            administrator's confirmation is the passkey's alone (`docs/frontend/spec.md :: I422`). */}
        {!verwaltung && (
          <CodeConfirmation
            address={sicherheit.inhaberAdresse}
            istInhaber={istInhaber}
            onConfirmed={() => enrolmentConfirmed(focusAfterWrite())}
          />
        )}
      </div>
    ) : (
      <FocusSlot name={HINZUFUEGEN}>
        <Hint
          mode="refusal"
          reason={sicherheit.kannHinzufuegen ? null : ZU_VIELE}
          label="Passkey hinzufügen">
          <Button
            type="button"
            variant="primary"
            isPending={istBeschaeftigt}
            isDisabled={!sicherheit.kannHinzufuegen}
            onPress={() => void fuegeHinzu()}
            className={formButton({ intent: "submit" })}>
            <Plus
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
            {istBeschaeftigt ? "Fügt hinzu..." : passkeys.length === 0 ? "Passkey einrichten" : "Passkey hinzufügen"}
          </Button>
        </Hint>
      </FocusSlot>
    );

  return (
    <section
      className={panel.root()}
      {...focusSection("sicherheit")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Sicherheit"
        />
      </div>

      <div className={panel.body()}>
        {/* A person with no passkey is offered one; an administrator with one, told what a second guards. */}
        {!verwaltung && passkeys.length === 0 && (
          <div className="flex flex-col gap-3">
            <Callout
              severity="info"
              title="Melde Dich ohne Code an"
            />
            {hinzufuegen}
          </div>
        )}
        {verwaltung && passkeys.length === 1 && (
          <Callout
            severity="warning"
            title="Richte einen zweiten Passkey ein">
            Mit einem zweiten Passkey auf einem anderen Gerät bleibst Du in der Verwaltung, auch wenn Du eines verlierst.
          </Callout>
        )}

        {passkeys.length > 0 && (
          <div
            className="flex flex-col gap-4"
            {...focusSection("passkeys")}>
            <h3
              {...FOCUS_HEADING}
              className={FORM_SECTION_HEADING_CLASSES}>
              Passkeys
            </h3>
            <ul className="flex flex-col gap-4">
              {passkeys.map((karte) => (
                <PasskeyKarteView
                  key={karte.id}
                  karte={karte}
                  // An administrator's last passkey is their way into the administration; a person's is not.
                  reason={verwaltung && passkeys.length <= 1 ? LETZTER_PASSKEY : null}
                  istLetzter={!verwaltung && passkeys.length === 1}
                  onRemove={entferne}
                  onRename={benenne}
                />
              ))}
            </ul>
            {hinzufuegen}
          </div>
        )}

        <div
          className="flex flex-col gap-4"
          {...focusSection("anmeldungen")}>
          <h3
            {...FOCUS_HEADING}
            className={FORM_SECTION_HEADING_CLASSES}>
            Anmeldungen
          </h3>
          <ul className="flex flex-col">
            {anmeldungen.map((anmeldung) => (
              <AnmeldungZeile
                key={anmeldung.id}
                anmeldung={anmeldung}
                onEnd={beende}
              />
            ))}
          </ul>

          {anmeldungen.some((anmeldung) => !anmeldung.diesesGeraet) && <AndereAbmelden onEnd={beendeAndere} />}
        </div>
      </div>

      <ModalShell
        isOpen={wartend !== null}
        onClose={() => setWartend(null)}
        heading={IDENTITY_CONFIRMATION_TITLE}
        size="confirm">
        <IdentityConfirmation
          hinweis={STEP_UP_HINT}
          hasPasskey={passkeys.length > 0}
          codeHalf={
            verwaltung ? null : (
              <CodeConfirmation
                address={sicherheit.inhaberAdresse}
                istInhaber={istInhaber}
                onConfirmed={steppedUp}
              />
            )
          }
          istInhaber={istInhaber}
          onConfirmed={steppedUp}
        />
      </ModalShell>
    </section>
  );
}

/** Why the enrolment did not happen, as far as a reader can act on it, or `null` where it did. */
async function enrolmentHeld(): Promise<EnrolmentHeld | null> {
  try {
    const { error } = await authClient.passkey.addPasskey();
    if (error === null) return null;

    if (error.status === 404) return enrolmentRefused();

    // A verification that never came back arrives as a 500 and an edge's answer as its own 5xx, and
    // either may follow a stored passkey (`docs/frontend/spec.md :: I326`); the browser's refusals are 400s.
    if (error.status >= 500) return { error: SPEICHERUNG_UNKLAR, outcome: "unknown" };

    return { error: VERSUCHE_ES_ERNEUT_SATZ };
  } catch {
    // Thrown only by the options request, ahead of the ceremony: the plugin's client answers every
    // later failure on `error` (`@better-auth/passkey` 1.7.7, read 2026-10-03).
    return { error: VERSUCHE_ES_ERNEUT_SATZ };
  }
}

/**
 * The enrolment guard answers the cap, a stale sign-in and an authenticator already held alike 404, so
 * the page asks again which it was (`docs/frontend/spec.md :: I427`); the third is the one left.
 */
async function enrolmentRefused(): Promise<EnrolmentHeld> {
  const stand = await readPasskeyStandAction().catch(unansweredAction);

  if (wantsStepUp(stand)) return { error: stand.error, stale: true };
  if (!stand.success) return { error: stand.error };
  return { error: stand.kannHinzufuegen ? VERSUCHE_ES_ERNEUT_SATZ : ZU_VIELE };
}
