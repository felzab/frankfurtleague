"use client";

import { useEffect, useState } from "react";

import { Plus } from "@gravity-ui/icons";

import { Button, Spinner } from "@heroui/react";

import { authClient } from "@/core/authClient";
import { formButton } from "@/shared/components/ui/formButtons";
import { Hint } from "@/shared/components/ui/Hint";
import { ModalShell } from "@/shared/components/ui/ModalShell";
import { appToast } from "@/shared/utils/appToast";

import { readPasskeysAction, removePasskeyAction } from "../../actions";
import { PasskeyEintragRow } from "./PasskeyEintragRow";

import type { PasskeyEintrag } from "../../types";

const UEBERSCHRIFT = "Passkeys";

const HINWEIS = "Mit jedem dieser Passkeys kommst Du in die Verwaltung.";

/**
 * Said before either control, because the browser's own prompt gives no reason: without it a second
 * passkey prompt on a page the reader is already signed in to reads as the session having lapsed.
 */
const BESTAETIGUNG_HINWEIS = "Zum Hinzufügen und Löschen fragen wir Dich zuerst nach einem Passkey, den Du schon hast.";

/** The way out alone: the toast's title has already said which of the two did not happen. */
const VERSUCHE_ES_ERNEUT = "Versuche es noch einmal.";

const BESTAETIGUNG_FEHLT = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

/**
 * The same sentence `fl_frontend/src/features/passkeys/actions.ts :: LETZTER_PASSKEY` answers: this
 * one closes the control and that one refuses a request reaching the action anyway. **Move both.**
 */
const LETZTER_PASSKEY = "Der letzte Passkey lässt sich nicht löschen.";

/** The cap's own sentence, which names the way forward rather than the number it refuses at. */
const ZU_VIELE = "Mehr Passkeys gehen nicht. Lösche zuerst einen.";

const NICHT_GELADEN = "Deine Passkeys ließen sich nicht laden.";

/** A read that answered no rows, which is not the read that failed: the two look alike and are not. */
const KEINE_PASSKEYS = "Für diesen Zugang ist kein Passkey eingetragen.";

/**
 * The dialog the sidemenu's options drop-up opens, never a page under `/admin`: managing one's own
 * credentials is account business rather than a section of the league's administration.
 */
export function PasskeyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [eintraege, setEintraege] = useState<PasskeyEintrag[] | null>(null);
  const [kannHinzufuegen, setKannHinzufuegen] = useState(false);
  const [ladefehler, setLadefehler] = useState(false);
  const [istBeschaeftigt, setIstBeschaeftigt] = useState(false);

  /** One answer applied, from wherever it was asked for: the opening below, or a finished write. */
  const uebernimm = (result: Awaited<ReturnType<typeof readPasskeysAction>>): void => {
    if (!result.success) {
      // An empty list AND the flag, because a read that failed and a read that answered nothing put
      // the same array on screen and owe the reader different sentences.
      setEintraege([]);
      setKannHinzufuegen(false);
      setLadefehler(true);
      appToast.danger("Passkeys nicht geladen", { description: result.error });
      return;
    }

    setEintraege(result.passkeys);
    setKannHinzufuegen(result.kannHinzufuegen);
    setLadefehler(false);
  };

  const lade = async (): Promise<void> => {
    uebernimm(await readPasskeysAction());
  };

  // Adjusted during render rather than in the effect below, as `SidemenuOptionsMenu :: SignOutItem`
  // adjusts its own: a `setState` inside an effect body cascades a second render for every opening.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setEintraege(null);
    setLadefehler(false);
  }

  // Re-read on every opening rather than once: another device of this administrator's may have
  // added or removed one since the dialog was last closed, and the list decides both refusals.
  useEffect(() => {
    if (!isOpen) return undefined;

    // Guarded rather than awaited: a dialog closed and opened again while the first read is still
    // in flight would otherwise take that read's answer over the second's.
    let current = true;
    void readPasskeysAction().then((result) => {
      if (current) uebernimm(result);
    });

    return () => {
      current = false;
    };
  }, [isOpen]);

  /**
   * The step-up, and the whole of what a cookie alone cannot do: the assertion mints a session whose
   * `createdAt` is now, and an authenticator this account never enrolled is answered 401.
   */
  const bestaetigt = async (): Promise<boolean> => {
    try {
      const { error } = await authClient.signIn.passkey();
      return error === null;
    } catch {
      return false;
    }
  };

  /** Why the enrolment did not happen, as far as a reader can act on it, or `null` where it did. */
  const enrolmentHeld = async (): Promise<string | null> => {
    try {
      if (!(await bestaetigt())) return BESTAETIGUNG_FEHLT;

      const { error } = await authClient.passkey.addPasskey();

      return error === null ? null : VERSUCHE_ES_ERNEUT;
    } catch {
      return VERSUCHE_ES_ERNEUT;
    }
  };

  const hinzufuegen = async (): Promise<void> => {
    setIstBeschaeftigt(true);
    const refusal = await enrolmentHeld();

    if (refusal !== null) {
      setIstBeschaeftigt(false);
      // One raising per outcome, and the literals at the call: `core/toastTitles.test.ts` reads a
      // title from the call site, and a second site sharing one is told apart by its description.
      appToast.danger("Passkey nicht hinzugefügt", { description: refusal });
      return;
    }

    appToast.success("Passkey hinzugefügt", { description: "Du kannst Dich jetzt auch damit anmelden." });
    await lade();
    // Cleared after the re-read and never before it: both of this control's own refusals are
    // computed from a list that is stale until the read lands.
    setIstBeschaeftigt(false);
  };

  const removalHeld = async (id: string): Promise<string | null> => {
    if (!(await bestaetigt())) return BESTAETIGUNG_FEHLT;

    const result = await removePasskeyAction(id);

    return result.success ? null : result.error;
  };

  const entfernen = async (id: string): Promise<void> => {
    // Held for a REMOVAL too, or the add control stays pressable over a list one of the rows below
    // is in the middle of changing.
    setIstBeschaeftigt(true);
    const refusal = await removalHeld(id);

    if (refusal !== null) {
      setIstBeschaeftigt(false);
      appToast.danger("Passkey nicht gelöscht", { description: refusal });
      return;
    }

    appToast.success("Passkey gelöscht", { description: "Alle anderen Geräte wurden abgemeldet." });
    await lade();
    setIstBeschaeftigt(false);
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      heading={UEBERSCHRIFT}>
      <div className="flex flex-col gap-4">
        <p className="muted-hint text-pretty">{HINWEIS}</p>
        <p className="muted-hint text-pretty">{BESTAETIGUNG_HINWEIS}</p>

        {eintraege === null ? (
          <Spinner aria-label="Lädt" />
        ) : (
          <ul className="flex flex-col">
            {eintraege.map((eintrag) => (
              <PasskeyEintragRow
                key={eintrag.id}
                eintrag={eintrag}
                reason={eintraege.length <= 1 ? LETZTER_PASSKEY : null}
                onRemove={entfernen}
              />
            ))}
          </ul>
        )}

        {eintraege !== null && ladefehler ? <p className="muted-hint">{NICHT_GELADEN}</p> : null}
        {eintraege !== null && !ladefehler && eintraege.length === 0 ? <p className="muted-hint">{KEINE_PASSKEYS}</p> : null}

        {/* The cap is announced off a list that has landed: before the read resolves the flag is
            still its own initial value, and a reader would meet a refusal nothing has judged. */}
        <Hint
          mode="refusal"
          reason={eintraege === null || kannHinzufuegen ? null : ZU_VIELE}
          label="Passkey hinzufügen">
          <Button
            type="button"
            variant="primary"
            isPending={istBeschaeftigt}
            isDisabled={eintraege === null || !kannHinzufuegen}
            onPress={() => void hinzufuegen()}
            className={formButton({ intent: "submit", fullWidth: true })}>
            <Plus
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
            {istBeschaeftigt ? "Fügt hinzu..." : "Passkey hinzufügen"}
          </Button>
        </Hint>
      </div>
    </ModalShell>
  );
}
