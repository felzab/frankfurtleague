"use client";

import { startTransition, useEffect, useOptimistic, useState } from "react";

import Plus from "@gravity-ui/icons/Plus";

import { Button } from "@heroui/react/button";
import { Spinner } from "@heroui/react/spinner";

import { authClient } from "@/core/authClient";
import { ENROLMENT_CONFLICT } from "@/core/passkeyRefusal";
import { formButton } from "@/shared/components/ui/formButtons";
import { Hint } from "@/shared/components/ui/Hint";
import { ModalShell } from "@/shared/components/ui/ModalShell";
import { unansweredAction, unansweredRead } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { readPasskeysAction, removePasskeyAction } from "../../actions";
import { PasskeyEintragRow } from "./PasskeyEintragRow";

import type { ActionFailure } from "@/shared/types/types";
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
 * The loser of two changes to this account's passkeys that ran at once (`docs/frontend/spec.md ::
 * I341`): the other was an enrolment or a removal, and nothing here tells which.
 */
const GLEICHZEITIG = "Gleichzeitig wurde ein anderer Passkey hinzugefügt oder gelöscht.";

/** Where the re-read shows the cap, the other change can only have been an enrolment. */
const GLEICHZEITIG_HINZUGEFUEGT = "Gleichzeitig wurde ein anderer Passkey hinzugefügt.";

/**
 * What the reader is told, and, where the list on screen may be missing a row, what they are told
 * instead once the re-read shows the cap reached.
 */
type Held = { readonly description: string; readonly whenFull: string | null };

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
 * The list read, caught at every call: uncaught, the opening's spinner stands for good and a
 * removal's re-read takes the page down.
 */
const liesPasskeys = (): ReturnType<typeof readPasskeysAction> => readPasskeysAction().catch(unansweredRead);

/**
 * The dialog the sidemenu's options drop-up opens, never a page under `/admin`: managing one's own
 * credentials is account business rather than a section of the league's administration.
 */
export function PasskeyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [eintraege, setEintraege] = useState<PasskeyEintrag[] | null>(null);
  const [kannHinzufuegen, setKannHinzufuegen] = useState(false);
  const [ladefehler, setLadefehler] = useState(false);
  const [istBeschaeftigt, setIstBeschaeftigt] = useState(false);
  // Optimistic, never plain state: a removal runs inside its row's press transition, which holds a
  // plain update back until the removal is over, so the add control would never be held.
  const [entferntGerade, setEntferntGerade] = useOptimistic(false);

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

  /** Whether the list read now stands at the cap. */
  const lade = async (): Promise<boolean> => {
    const result = await liesPasskeys();
    uebernimm(result);
    return result.success && !result.kannHinzufuegen;
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
    void liesPasskeys().then((result) => {
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
  const enrolmentHeld = async (): Promise<Held | null> => {
    try {
      if (!(await bestaetigt())) return { description: BESTAETIGUNG_FEHLT, whenFull: null };

      const { error } = await authClient.passkey.addPasskey();

      if (error === null) return null;

      // Read off the body rather than the type: a server's refusal arrives on the branch that declares
      // no `code`, and its body has one.
      if (Reflect.get(error, "code") === ENROLMENT_CONFLICT) {
        return { description: `${GLEICHZEITIG} ${VERSUCHE_ES_ERNEUT}`, whenFull: `${GLEICHZEITIG_HINZUGEFUEGT} ${ZU_VIELE}` };
      }

      // The guard's own refusal, which an enrolment another device finished first earns too, the
      // cap among its causes.
      if (error.status === 404) return { description: VERSUCHE_ES_ERNEUT, whenFull: ZU_VIELE };

      return { description: VERSUCHE_ES_ERNEUT, whenFull: null };
    } catch {
      return { description: VERSUCHE_ES_ERNEUT, whenFull: null };
    }
  };

  const hinzufuegen = async (): Promise<void> => {
    setIstBeschaeftigt(true);
    const held = await enrolmentHeld();

    if (held !== null) {
      // The list may be missing the other change's row, which may also have closed the add control.
      const full = held.whenFull !== null && (await lade());
      setIstBeschaeftigt(false);
      // One raising per outcome, and the literals at the call: `core/toastTitles.test.ts` reads a
      // title from the call site, and a second site sharing one is told apart by its description.
      appToast.danger("Passkey nicht hinzugefügt", { description: full && held.whenFull !== null ? held.whenFull : held.description });
      return;
    }

    appToast.success("Passkey hinzugefügt", { description: "Du kannst Dich jetzt auch damit anmelden." });
    await lade();
    // Cleared after the re-read and never before it: both of this control's own refusals are
    // computed from a list that is stale until the read lands.
    setIstBeschaeftigt(false);
  };

  /** Why the removal did not plainly land, and whether it reached the server, the list then being suspect. */
  const removalHeld = async (id: string): Promise<(Pick<ActionFailure, "error" | "outcome"> & { reread: boolean }) | null> => {
    if (!(await bestaetigt())) return { error: BESTAETIGUNG_FEHLT, reread: false };

    // A rejected action may still have removed the row, and uncaught here it takes the page down with it.
    const result = await removePasskeyAction(id).catch(unansweredAction);

    // The outcome rides along: a removal nobody can tell landed is titled neither way (`docs/frontend/spec.md :: I326`).
    return result.success ? null : { error: result.error, outcome: result.outcome, reread: true };
  };

  const entfernen = async (id: string): Promise<void> => {
    // Held for a REMOVAL too, or the add control stays pressable over a list one of the rows below
    // is in the middle of changing; the press's transition ending is what releases it.
    setEntferntGerade(true);
    const held = await removalHeld(id);

    if (held !== null) {
      // The server's refusal may answer a list another change moved -- a row already gone, or one
      // added or removed at the same moment -- so the list is read again before the control reopens.
      const gelesen = held.reread ? await liesPasskeys() : null;
      // Wrapped again, to the end of the path: the press runs this inside its transition, and React
      // leaves an update after an `await` outside it. The toast queue is an external store, so no
      // wrap holds the toast back.
      startTransition(() => {
        if (gelesen !== null) uebernimm(gelesen);
        appToast.failure("Passkey nicht gelöscht", held);
      });
      return;
    }

    appToast.success("Passkey gelöscht", { description: "Alle anderen Geräte wurden abgemeldet." });
    const gelesen = await liesPasskeys();
    // Wrapped again, as above: the list commits with the press's own release, and the hold with it.
    startTransition(() => {
      uebernimm(gelesen);
    });
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
            isDisabled={eintraege === null || !kannHinzufuegen || entferntGerade}
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
