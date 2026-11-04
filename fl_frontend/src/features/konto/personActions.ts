"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { linkInvalid } from "@/kit/MailedPage";
import { z } from "zod";

import { action } from "@/core/action";
import { deleteOwnAccount } from "@/core/auth/accounts";
import { getKontoSession } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { formatInstant } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { mapKontoAdresswechselRefusal, mapKontoFreigabeRefusal, mapKontoStoppRefusal } from "@/features/adresswechsel/refusals";
import { refusalResult, stepUpRequired } from "@/shared/utils/adminMutation";
import { enrolmentUntil } from "@/shared/utils/kontoMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { genehmigerText } from "./genehmiger";
import { beantrageKontoAdresswechsel, gibKontoAdresswechselFrei, loeschenEigeneDaten, stoppeKontoAdresswechsel } from "./mutations";
import { getLoeschungAnsicht } from "./queries";
import { FLKontoAdresswechselFreigabePayloadSchema, FLKontoAdresswechselPayloadSchema } from "./schemas";

import type { ActionAnswer } from "@/core/action";
import type { FLVerwaltung } from "@/core/generated/client/types";
import type { MailedEnd } from "@/kit/MailedPage";
import type { ActionResult } from "@/shared/types/types";
import type { StepUpRequired } from "@/shared/utils/adminMutation";

/**
 * Completes a mailed deletion link: the league's records, then the account, the passkey touch first for a person
 * holding one. The deletion ends the caller's own session, so a done one leads to a page needing none rather than
 * answering: Next renders the posting page again after an action writes a cookie, and the library deletes the session's
 * cookie, but a `redirect` from the body renders the destination alone, the builder having cleared the site's tag on
 * its way out. A link the library refuses, spent, lapsed or another account's, ends as the link no longer valid, with
 * nothing erased.
 */
export const kontoLoeschen = action({
  lane: "person",
  claim: "record",
  passkey: true,
  name: "kontoLoeschen",
  // The library's own token, which no backend schema publishes: one line of letters, digits, `-` and `_`.
  input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }),
  ownWords: ["last_owner_erasure"],
  run: async ({ token }, { subject }): Promise<ActionAnswer<MailedEnd>> => {
    // Refused before the library spends the link, so the same link completes once another owner is made; the
    // backend refuses two owners at once. Read for an owner alone, the one tier that can be the last.
    if (subject.subject.verwaltung === "owner" && (await getLoeschungAnsicht()).last_owner) {
      return { ok: false, reason: SERVER_COPY.refusalLine.last_owner_erasure };
    }

    const outcome = await deleteOwnAccount(token, await headers(), () => loeschenEigeneDaten());
    if (outcome === "linkRefused")
      return { ok: true, value: linkInvalid({ label: COPY.shared.end.toAccount, href: ROUTES.accountSignIn.path() }) };

    redirect(ROUTES.accountErased.path());
  },
});

/** What the account page is told of a link it owed: a sentence, never a token or an address. */
type AdresswechselGesendet = ActionResult;

/** Said where the address holds a grant: the change waits for its approver too, the old address signing in meanwhile. */
const genehmigungSatz = (verwaltung: FLVerwaltung): string =>
  `Weil Deine Adresse Zugang zur Verwaltung hat, muss außerdem ${genehmigerText(verwaltung)} zustimmen. Bis dahin meldest Du Dich weiter mit dieser Adresse an.`;

/**
 * One sentence whatever becomes of the mail, which leaves behind the answer: a barred address hears nothing, and
 * naming the ban would tell a stranger typing the address that it is known here.
 */
function gesendetSatz(gueltigBis: string, art: "start" | "freigabe"): string {
  const bitte = `Bestätige die neue Adresse über den Link in der E-Mail an sie, bis ${formatInstant(gueltigBis)}.`;
  // Only the start's notice goes to the address on file; the approval's request went at the administrator's start.
  const sonst =
    art === "start"
      ? " Kommt keine E-Mail an, prüfe die Adresse oben. Ist sie falsch, zieh die Änderung zurück und gib sie neu ein. Deine bisherige Adresse bekommt einen Hinweis."
      : "";
  return `${bitte}${sonst}`;
}

/** Whether the request's session is inside the enrolment window, which the backend judges again at `iat`. */
async function istFrischBestaetigt(): Promise<boolean> {
  const served = await getKontoSession();
  return served !== null && enrolmentUntil(served) !== null;
}

/**
 * The person's own start from the account page, inside the enrolment window: the
 * link goes to the new address, a stop link to the signed-in one, and, where a grant moves, word to its approvers.
 */
export async function starteAdresswechselAction(rawPayload: { email: string }): Promise<AdresswechselGesendet | StepUpRequired> {
  return runPersonRecordMutation("starteAdresswechselAction", async (subject) => {
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

    const { verwaltung } = subject.subject;
    const gesendet = gesendetSatz(mint.valid_until, "start");
    return {
      success: true,
      // The tier off the grant the spine's subject read found: a grant's move waits on an approver, whom the start
      // refused to go without.
      message: verwaltung === null ? gesendet : `${gesendet} ${genehmigungSatz(verwaltung)}`,
    };
  });
}

/**
 * The address on file's approval of the change its page showed, one an administrator started without a reason: only
 * now does the new address get its link. A later start replaced the shown one, and the press then approves nothing.
 */
export async function gibAdresswechselFreiAction(rawPayload: { id: string }): Promise<AdresswechselGesendet | StepUpRequired> {
  return runPersonRecordMutation("gibAdresswechselFreiAction", async () => {
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

    return { success: true, message: gesendetSatz(freigabe.valid_until, "freigabe") };
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
