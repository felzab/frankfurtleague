"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { adresswechselZeitpunkt } from "@/core/adresswechsel";
import { deleteOwnAccount, getKontoSession } from "@/core/auth";
import { recordWriteSent } from "@/core/requestScope";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { mailSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/notifications";
import { mailSpielerAdresswechsel } from "@/features/spieler/notifications";
import { invalidatesOnWrite, refusalResult, stepUpRequired } from "@/shared/utils/adminMutation";
import { enrolmentUntil } from "@/shared/utils/kontoMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { beantrageKontoAdresswechsel, eraseEigeneDaten, gibKontoAdresswechselFrei, stoppeKontoAdresswechsel } from "./mutations";
import { getLoeschungAnsicht } from "./queries";
import { LETZTE_INHABERIN, mapKontoAdresswechselRefusal, mapKontoFreigabeRefusal, mapKontoStoppRefusal, mapLoeschungRefusal } from "./refusals";
import { FLKontoAdresswechselPayloadSchema } from "./schemas";

import type { FLSpielerAdresswechselMint } from "@/features/spieler/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { StepUpRequired } from "@/shared/utils/adminMutation";
import type { LinkVersand } from "@/shared/utils/linkVersand";

/** What the library's refusal of a link means to its holder, the token being spent before it was refused. */
const LINK_UNGUELTIG =
  "Dieser Link lässt sich nicht mehr verwenden: Er ist abgelaufen, wurde schon verwendet oder gehört zu einem anderen Konto. Fordere auf Deiner Kontoseite einen neuen an.";

/** Every other failure once the library may have spent the link, whose next press would meet `LINK_UNGUELTIG`. */
const LINK_VERBRAUCHT = "Dieser Link ist dabei verbraucht worden. Für einen neuen Versuch fordere auf Deiner Kontoseite einen neuen an.";

/**
 * Completes a mailed deletion link, the league's records before the account (`docs/frontend/spec.md ::
 * I675`). The person-record spine sends the actor the backend's person route reads, and refuses
 * sessions the library itself would accept.
 */
export async function loescheKontoAction(token: string): Promise<ActionResult> {
  // Whether the press reached the library, which may spend the link, and whether the library refused the link itself.
  const link = { spent: false, refused: false };

  const answer = await runPersonRecordMutation("loescheKontoAction", async (subject) => {
    // A server action's argument is whatever a caller posted, and this one reaches the sign-in store.
    if (typeof token !== "string" || token === "") return { success: false, error: VALIDATION_FAILED };

    // Unconditional: the erasure reaches a squad and a fixture whatever this person turns out to hold.
    invalidatesOnWrite("spieler", "spiele");

    // Refused before the library spends the link, so the same link completes once another owner is made
    // (`docs/frontend/spec.md :: I708`); the backend refuses two owners at once. Read for an owner alone,
    // the one tier that can be the last.
    if (subject.subjekt.verwaltung === "owner" && (await getLoeschungAnsicht()).letzter_inhaber) {
      return { success: false, error: LETZTE_INHABERIN };
    }

    // A grant goes with the account, so a grant holder is held to a revoke's window, a passkey confirmation
    // of the enrolment's minutes (`docs/frontend/spec.md :: I707`), judged before the library spends the link.
    if (subject.subjekt.verwaltung !== null) {
      const verwaltend = await getKontoSession();
      if (verwaltend === null || enrolmentUntil(verwaltend) === null) {
        // The page's figures read again, so its next press asks first (`docs/frontend/spec.md :: I433`).
        refresh();
        return stepUpRequired();
      }
    }

    // The token is spent in the sign-in store, written past the API client, whatever the press comes to.
    recordWriteSent();
    link.spent = true;

    let outcome;
    try {
      outcome = await deleteOwnAccount(token, await headers(), () => eraseEigeneDaten());
    } catch (error) {
      // The backend's own refusal of the last owner; every other throw is the spine's to answer.
      const refusal = mapLoeschungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }
    if (outcome === "linkRefused") {
      link.refused = true;
      return { success: false, error: LINK_UNGUELTIG };
    }

    return { success: true, message: "Dein Konto und Deine Angaben sind gelöscht." };
  });

  // Past the spend every answer but a deletion leaves a link the next press cannot take, which the spine's
  // own words, a retry's or a reload's, would hide.
  if (answer.success || !link.spent || link.refused) return answer;
  return { ...answer, error: `${answer.error} ${LINK_VERBRAUCHT}` };
}

/** What the account page is told of a link it mailed: the outcome alone, never a token or an address. */
type AdresswechselGesendet = ActionResult<{ versand: LinkVersand }>;

/**
 * Either lane's mailer, by the carrier the backend chose: the token is looked up in that lane's collection,
 * so its page and its delivery tag are that lane's.
 */
function mailAdresswechsel(operation: string, art: "spieler" | "schiedsrichter", id: string, mint: FLSpielerAdresswechselMint) {
  return art === "spieler"
    ? mailSpielerAdresswechsel({ operation: operation, spielerId: id, mint: mint, anlass: "empfang" })
    : mailSchiedsrichterAdresswechsel({ operation: operation, schiedsrichterId: id, mint: mint, anlass: "empfang" });
}

/**
 * One sentence for a link that went out and for one the ban list kept: telling the person their new
 * address is barred would answer a stranger typing it whether an address is known here. A failed send
 * says so, its repair being a fresh start, which replaces the change.
 */
function gesendetSatz(versand: LinkVersand, gueltigBis: string, mitHinweis: boolean): { versand: LinkVersand; message: string } {
  if (versand === "fehlgeschlagen") {
    return {
      versand: versand,
      message: "Der Link an die neue Adresse ging nicht raus. Versuch es noch einmal: Ein neuer Link ersetzt den alten.",
    };
  }
  if (versand === "zurueckgehalten") return { versand: versand, message: ZURUECKGEHALTEN };

  const bitte = `Bestätige die neue Adresse über den Link in der E-Mail an sie, bis ${adresswechselZeitpunkt(gueltigBis)}.`;
  const sonst = mitHinweis
    ? " Kommt keine an, prüfe die Adresse und versuch es noch einmal. Deine bisherige Adresse bekommt einen Hinweis."
    : "";
  return { versand: "gesendet", message: `${bitte}${sonst}` };
}

/** Whether the request's session is inside the enrolment window, which the backend judges again at `iat`. */
async function istFrischBestaetigt(): Promise<boolean> {
  const served = await getKontoSession();
  return served !== null && enrolmentUntil(served) !== null;
}

/**
 * The person's own start of a change from the account page, inside the enrolment window
 * (`docs/frontend/spec.md :: I411`): the link goes to the new address, and a notice with a stop link to
 * the one signed in.
 */
export async function beantrageAdresswechselAction(rawPayload: { email: string }): Promise<AdresswechselGesendet | StepUpRequired> {
  return runPersonRecordMutation("beantrageAdresswechselAction", async () => {
    const validated = FLKontoAdresswechselPayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    // An address change outlives the session making it, as a passkey does: the page's next press asks first.
    if (!(await istFrischBestaetigt())) {
      refresh();
      return stepUpRequired();
    }

    let mint;
    try {
      mint = await beantrageKontoAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapKontoAdresswechselRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    const { link } = await mailAdresswechsel("beantrageAdresswechselAction", mint.art, mint.id, {
      ...mint,
      weg: "konto",
      adresse_belegt: false,
    });

    // `link` is never null here: the person's start mints both tokens.
    return { success: true, ...gesendetSatz(link ?? "fehlgeschlagen", mint.gueltig_bis, true) };
  });
}

/** The address on file's approval of a change an administrator started without a reason: only now does the new address get its link. */
export async function gibAdresswechselFreiAction(): Promise<AdresswechselGesendet | StepUpRequired> {
  return runPersonRecordMutation("gibAdresswechselFreiAction", async (subject) => {
    // The approval hands the records over as a start does, so it is held to the same window.
    if (!(await istFrischBestaetigt())) {
      refresh();
      return stepUpRequired();
    }

    let freigabe;
    try {
      freigabe = await gibKontoAdresswechselFrei();
    } catch (error) {
      const refusal = mapKontoFreigabeRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    // No stop token: the notice with its stop link went out at the start. The address on file is the
    // signed-in one, and the greeting it would carry is never built without a notice to send.
    const { link } = await mailAdresswechsel("gibAdresswechselFreiAction", freigabe.art, freigabe.id, {
      ...freigabe,
      weg: "freigabe",
      stopp_token: null,
      bisherige_email: subject.email,
      vorname: "",
      adresse_belegt: false,
    });

    return { success: true, ...gesendetSatz(link ?? "fehlgeschlagen", freigabe.gueltig_bis, false) };
  });
}

/** The address on file's stop of a pending change. It hands nothing over, so it asks no fresh sign-in. */
export async function stoppeAdresswechselAction(): Promise<ActionResult> {
  return runPersonRecordMutation("stoppeAdresswechselAction", async () => {
    try {
      await stoppeKontoAdresswechsel();
    } catch (error) {
      const refusal = mapKontoStoppRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return { success: true, message: "Diese Adresse bleibt." };
  });
}
