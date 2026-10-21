"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { adresswechselZeitpunkt } from "@/core/adresswechsel";
import { deleteOwnAccount, getKontoSession } from "@/core/auth";
import { KONTAKT_EMAIL } from "@/core/brand";
import { recordWriteSent } from "@/core/requestScope";
import { mailAdresswechsel, mailGenehmigungWartet } from "@/features/adresswechsel/notifications";
import { mapKontoAdresswechselRefusal, mapKontoFreigabeRefusal, mapKontoStoppRefusal } from "@/features/adresswechsel/refusals";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { invalidatesOnWrite, refusalResult, stepUpRequired } from "@/shared/utils/adminMutation";
import { enrolmentUntil } from "@/shared/utils/kontoMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { beantrageKontoAdresswechsel, eraseEigeneDaten, gibKontoAdresswechselFrei, stoppeKontoAdresswechsel } from "./mutations";
import { getLoeschungAnsicht } from "./queries";
import { LETZTE_INHABERIN, mapLoeschungRefusal } from "./refusals";
import { FLKontoAdresswechselFreigabePayloadSchema, FLKontoAdresswechselPayloadSchema } from "./schemas";

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

/** Said where the address holds a grant: the change waits for another administrator too, the old address signing in meanwhile. */
const GENEHMIGUNG_SATZ =
  "Weil Deine Adresse Zugang zur Verwaltung hat, muss außerdem eine andere Person aus der Verwaltung zustimmen. Bis dahin meldest Du Dich weiter mit dieser Adresse an.";

/**
 * One sentence for a link sent and one the ban list kept: naming the ban would tell a stranger typing the
 * address that it is known here. Each repair is one the page then offers.
 */
function gesendetSatz(versand: LinkVersand, gueltigBis: string, art: "start" | "freigabe"): { versand: LinkVersand; message: string } {
  if (versand === "fehlgeschlagen") {
    return {
      versand: versand,
      message:
        art === "start"
          ? "Der Link an die neue Adresse ging nicht raus. Zieh die Änderung zurück und gib die Adresse erneut ein: Ein neuer Link ersetzt den alten."
          : `Der Link an die neue Adresse ging nicht raus. Die Verwaltung kann ihn erneut senden, schreib uns an ${KONTAKT_EMAIL}.`,
    };
  }
  if (versand === "zurueckgehalten") return { versand: versand, message: ZURUECKGEHALTEN };

  const bitte = `Bestätige die neue Adresse über den Link in der E-Mail an sie, bis ${adresswechselZeitpunkt(gueltigBis)}.`;
  // Only the start's notice goes to the address on file; the approval's request went at the administrator's start.
  const sonst =
    art === "start"
      ? " Kommt keine E-Mail an, prüfe die Adresse oben. Ist sie falsch, zieh die Änderung zurück und gib sie neu ein. Deine bisherige Adresse bekommt einen Hinweis."
      : "";
  return { versand: "gesendet", message: `${bitte}${sonst}` };
}

/** Whether the request's session is inside the enrolment window, which the backend judges again at `iat`. */
async function istFrischBestaetigt(): Promise<boolean> {
  const served = await getKontoSession();
  return served !== null && enrolmentUntil(served) !== null;
}

/**
 * The person's own start from the account page, inside the enrolment window (`docs/frontend/spec.md :: I806`): the
 * link goes to the new address, a stop link to the signed-in one, and, where a grant moves, word to its approvers.
 */
export async function starteAdresswechselAction(rawPayload: { email: string }): Promise<AdresswechselGesendet | StepUpRequired> {
  return runPersonRecordMutation("starteAdresswechselAction", async () => {
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

    const [{ link }] = await Promise.all([
      mailAdresswechsel({ operation: "starteAdresswechselAction", mint: { ...mint, weg: "konto" }, anlass: "empfang" }),
      mailGenehmigungWartet({ operation: "starteAdresswechselAction", genehmiger: mint.genehmiger }),
    ]);

    // `link` is never null here: the person's start mints both tokens.
    const gesendet = gesendetSatz(link ?? "fehlgeschlagen", mint.gueltig_bis, "start");
    return {
      success: true,
      versand: gesendet.versand,
      message: mint.genehmiger.length === 0 ? gesendet.message : `${gesendet.message} ${GENEHMIGUNG_SATZ}`,
    };
  });
}

/**
 * The address on file's approval of the change its page showed, one an administrator started without a reason: only
 * now does the new address get its link. A later start replaced the shown one, and the press then approves nothing.
 */
export async function gibAdresswechselFreiAction(rawPayload: { id: string }): Promise<AdresswechselGesendet | StepUpRequired> {
  return runPersonRecordMutation("gibAdresswechselFreiAction", async (subject) => {
    const validated = FLKontoAdresswechselFreigabePayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: VALIDATION_FAILED };

    // The approval hands the records over as a start does, so it is held to the same window.
    if (!(await istFrischBestaetigt())) {
      refresh();
      return stepUpRequired();
    }

    let freigabe;
    try {
      freigabe = await gibKontoAdresswechselFrei(validated.data);
    } catch (error) {
      const refusal = mapKontoFreigabeRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    // No stop token: the notice with its stop link went out at the start. The address on file is the
    // signed-in one, and the greeting it would carry is never built without a notice to send.
    const { link } = await mailAdresswechsel({
      operation: "gibAdresswechselFreiAction",
      mint: { ...freigabe, weg: "freigabe", stopp_token: null, bisherige_email: subject.email, vorname: "" },
      anlass: "empfang",
    });

    return { success: true, ...gesendetSatz(link ?? "fehlgeschlagen", freigabe.gueltig_bis, "freigabe") };
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
