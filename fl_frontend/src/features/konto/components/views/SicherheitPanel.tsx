"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import Plus from "@gravity-ui/icons/Plus";

import { Button } from "@heroui/react/button";

import { authClient } from "@/core/authClient";
import { ENROLMENT_CONFLICT } from "@/core/passkeyRefusal";
import { STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";
import { removePasskeyAction, renamePasskeyAction } from "@/features/passkeys/actions";
import { LETZTER_PASSKEY, PasskeyKarteView } from "@/features/passkeys/components/ui/PasskeyKarteView";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { IDENTITY_CONFIRMATION_TITLE, IdentityConfirmation } from "@/shared/components/ui/IdentityConfirmation";
import { ModalShell } from "@/shared/components/ui/ModalShell";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { endAndereAnmeldungenAction, endAnmeldungAction } from "../../actions";
import { AndereAbmelden } from "../ui/AndereAbmelden";
import { AnmeldungZeile } from "../ui/AnmeldungZeile";

import type { ActionFailure } from "@/shared/types/types";
import type { Sicherheit } from "../../types";

/** Why the page asks before a change, said on the panel that asks. */
const BESTAETIGUNG_HINWEIS = "Für Änderungen an Passkeys und Anmeldungen fragen wir kurz nach.";

/** The cap's own sentence, which names the way forward rather than the number it refuses at. */
const ZU_VIELE = "Mehr Passkeys gehen nicht. Lösche zuerst einen.";

const VERSUCHE_ES_ERNEUT = "Versuche es noch einmal.";

/**
 * The loser of two enrolments that ran at once (`docs/frontend/spec.md :: I341`): the other was an
 * enrolment or a removal, and nothing here tells which.
 */
const GLEICHZEITIG = "Gleichzeitig wurde ein anderer Passkey hinzugefügt oder gelöscht.";

/** Where the sign-in page is: a removal of the passkey this device signed in with ends the page's own session. */
const SIGN_IN = "/signin";

/** A change the page runs, which answers whether it still needs a confirmation the page did not get. */
type Aenderung = () => Promise<"erledigt" | "bestaetigen">;

/** An action's refusal for want of a recent sign-in, which the page answers by asking rather than by a toast. */
const verlangtBestaetigung = (result: { success: boolean }): boolean => !result.success && Reflect.get(result, "bestaetigen") === true;

/**
 * The „Sicherheit“ section: the passkeys, the sign-ins, and the one confirmation every change on it
 * passes (`docs/frontend/spec.md :: I413`).
 */
export function SicherheitPanel({ sicherheit }: { sicherheit: Sicherheit }) {
  const router = useRouter();
  const panel = formPanel();
  const { passkeys, anmeldungen, verwaltung } = sicherheit;

  // Moved by a confirmation made on this page, which the server's figure lags until the refresh lands.
  const [bestaetigtBis, setBestaetigtBis] = useState(sicherheit.bestaetigtBis);
  const [wartend, setWartend] = useState<Aenderung | null>(null);
  const [istBeschaeftigt, setIstBeschaeftigt] = useState(false);

  const istBestaetigt = (): boolean => bestaetigtBis !== null && Date.now() < bestaetigtBis;

  /** Runs `change` now if the page's session counts as confirmed, and after the panel's confirmation otherwise. */
  const mitBestaetigung = async (change: Aenderung): Promise<void> => {
    if (istBestaetigt() && (await change()) === "erledigt") return;
    setWartend(() => change);
  };

  const bestaetigt = (): void => {
    const change = wartend;
    setWartend(null);
    setBestaetigtBis(Date.now() + STEP_UP_WINDOW_MS);
    // The confirmation minted a new session and ended this page's: what the page drew off the old one,
    // „Dieses Gerät“ among it, is read again.
    router.refresh();
    if (change !== null) void change();
  };

  const entferne = (id: string): Promise<void> =>
    mitBestaetigung(async () => {
      // A rejected action may still have removed the row, and uncaught here it takes the page down with it.
      const result = await removePasskeyAction(id).catch(unansweredAction);
      if (verlangtBestaetigung(result)) return "bestaetigen";

      if (!result.success) {
        appToast.failure("Passkey nicht gelöscht", result);
        return "erledigt";
      }

      appToast.success("Passkey gelöscht", { description: "Geräte, die damit angemeldet waren, wurden abgemeldet." });
      // The removal ended the session this page ran in: the sign-in page is where it can go on.
      if (result.diesesGeraet) router.replace(SIGN_IN);
      return "erledigt";
    });

  const benenne = async (id: string, name: string): Promise<boolean> => {
    let gelandet = false;
    await mitBestaetigung(async () => {
      const result = await renamePasskeyAction(id, name).catch(unansweredAction);
      if (verlangtBestaetigung(result)) return "bestaetigen";

      if (result.success) {
        gelandet = true;
        appToast.success("Passkey umbenannt");
      } else {
        appToast.failure("Passkey nicht umbenannt", result);
      }
      return "erledigt";
    });
    return gelandet;
  };

  const beende = (id: string): Promise<void> =>
    mitBestaetigung(async () => {
      const result = await endAnmeldungAction(id).catch(unansweredAction);
      if (verlangtBestaetigung(result)) return "bestaetigen";

      if (result.success) appToast.success("Abgemeldet", { description: "Die Anmeldung ist beendet." });
      else appToast.failure("Nicht abgemeldet", result);
      return "erledigt";
    });

  const beendeAndere = (): Promise<void> =>
    mitBestaetigung(async () => {
      const result = await endAndereAnmeldungenAction().catch(unansweredAction);
      if (verlangtBestaetigung(result)) return "bestaetigen";

      if (result.success) appToast.success("Alle anderen abgemeldet");
      else appToast.failure("Nicht abgemeldet", result);
      return "erledigt";
    });

  // Pressed again after a confirmation rather than run by it: the browser opens a second passkey
  // prompt only on a fresh press, and the confirmation's own prompt spent the one that opened it.
  const fuegeHinzu = async (): Promise<void> => {
    if (!istBestaetigt()) {
      setWartend(() => async () => "erledigt" as const);
      return;
    }
    await (async () => {
      setIstBeschaeftigt(true);
      const held = await enrolmentHeld();
      setIstBeschaeftigt(false);
      // The enrolment writes past every server action, so nothing refreshed the page for it.
      startTransition(() => router.refresh());

      if (held === null) {
        appToast.success("Passkey hinzugefügt", { description: "Du kannst Dich jetzt auch damit anmelden." });
      } else {
        appToast.failure("Passkey nicht hinzugefügt", held);
      }
    })();
  };

  const hinzufuegen = (
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
  );

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Sicherheit"
        />
      </div>

      <div className={panel.body()}>
        {/* A person with no passkey is told what one saves them; an administrator with one, what a second guards. */}
        {!verwaltung && passkeys.length === 0 && (
          <div className="flex flex-col gap-3">
            <Callout
              severity="info"
              title="Melde Dich ohne Code an">
              Was ist ein Passkey? Ein digitaler Schlüssel, den Dein Gerät sicher speichert. Wo wird er gespeichert? In Deinem Passwortmanager,
              zum Beispiel im iCloud-Schlüsselbund oder im Google Passwortmanager, damit Du Dich auch auf Deinen anderen Geräten anmelden
              kannst.
            </Callout>
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
          <div className="flex flex-col gap-4">
            <h3 className="fluid-sm font-extrabold tracking-tight text-foreground">Passkeys</h3>
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

        <div className="flex flex-col gap-4">
          <h3 className="fluid-sm font-extrabold tracking-tight text-foreground">Anmeldungen</h3>
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
          hinweis={BESTAETIGUNG_HINWEIS}
          // The code half arrives with the code sign-in; until then a person confirms by passkey too.
          codeHalf={null}
          onConfirmed={bestaetigt}
        />
      </ModalShell>
    </section>
  );
}

/** Why the enrolment did not happen, as far as a reader can act on it, or `null` where it did. */
async function enrolmentHeld(): Promise<Pick<ActionFailure, "error" | "outcome"> | null> {
  try {
    const { error } = await authClient.passkey.addPasskey();
    if (error === null) return null;

    // Read off the body rather than the type: a server's refusal arrives on the branch that declares
    // no `code`, and its body has one.
    if (Reflect.get(error, "code") === ENROLMENT_CONFLICT) return { error: `${GLEICHZEITIG} ${VERSUCHE_ES_ERNEUT}` };

    // The guard's own refusal, which an enrolment another device finished first earns too, the cap among its causes.
    if (error.status === 404) return { error: ZU_VIELE };

    // A verification that never came back arrives as a 500 and an edge's answer as its own 5xx, and
    // either may follow a stored passkey (`docs/frontend/spec.md :: I326`); the browser's refusals are 400s.
    if (error.status >= 500) return { error: unansweredAction().error, outcome: "unknown" };

    return { error: VERSUCHE_ES_ERNEUT };
  } catch {
    // Thrown only by the options request, ahead of the ceremony: the plugin's client answers every
    // later failure on `error` (`@better-auth/passkey` 1.7.5, read 2026-09-24).
    return { error: VERSUCHE_ES_ERNEUT };
  }
}
