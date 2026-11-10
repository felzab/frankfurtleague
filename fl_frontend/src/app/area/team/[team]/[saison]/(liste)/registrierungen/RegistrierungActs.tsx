"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";
import { Dialog } from "@/kit/Dialog";
import { RadioGroup } from "@/kit/RadioGroup";
import { appToast } from "@/kit/Toast";
import { answering } from "@/kit/useFormAction";

import { COPY } from "@/core/copy";

import { admitRegistrierung, declineRegistrierung } from "./decideRegistrierung";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

const WORDS = COPY.area.team.registrierung;

/** The registration a row decides, at the team and season the page stands at, which every press claims its seat on. */
export type Decided = { team_id: string; saison_id: string; registrierung_id: string };

/**
 * What „Aufnehmen“ does on a row: nothing, with its reason, while the registration cannot be admitted; at once, into
 * the stored person its address names or a new one; or, where that person's details differ, after the team answers
 * whether the registration is that person.
 */
export type Admission =
  { kind: "locked"; reason: Copy } | { kind: "once"; spieler_id: string | null } | { kind: "asks"; spieler_id: string; name: string };

/** The same-person question's two answers, by the radio's value. */
const SAME = "same";
const OTHER = "other";

/** An admission's answer as its toast: „Aufgenommen“, or the refusal in its own words. */
function toastOf(answer: ActionAnswer) {
  appToast(answer.ok ? "success" : "danger", answer.ok ? COPY.shared.toast.admitted : (answer.reason ?? COPY.shared.toast.failure));
}

/** „Aufnehmen“ acting at once, as the owner ruled: a wrong admission is undone in the Kader by „Austragen“. */
function AdmitAtOnce({ decided, spielerId }: { decided: Decided; spielerId: string | null }) {
  const router = useRouter();
  const [isAdmitting, startAdmitting] = useTransition();
  return (
    <Button
      variant="primary"
      label={COPY.shared.verb.admit}
      isBusy={isAdmitting}
      onPress={() =>
        startAdmitting(async () => {
          toastOf(await answering(admitRegistrierung, router.refresh)({ ...decided, spieler_id: spielerId }));
        })
      }
    />
  );
}

/**
 * „Aufnehmen“ where the address is a stored person's under other details: the team answers whose registration it is.
 * The known person is the answer standing chosen, the one that keeps a returning pupil from entering the league twice;
 * the other declines the registration, and the pupil's mail asks them to register under an address of their own.
 */
function AdmitAsked({ decided, spielerId, name }: { decided: Decided; spielerId: string; name: string }) {
  const person = { record: name };
  return (
    <Dialog
      title={COPY.shared.withObject(COPY.page.registrierung, "admit")}
      act={{ verb: "confirm" }}
      action={async (formData) => {
        if (formData.get("answer") === OTHER) return declineRegistrierung({ ...decided, reason: "other_person" });
        const answer = await admitRegistrierung({ ...decided, spieler_id: spielerId });
        if (answer.ok) toastOf(answer);
        return answer;
      }}
      trigger={
        <Button
          variant="primary"
          label={COPY.shared.verb.admit}
        />
      }>
      <RadioGroup
        label={WORDS.earlierEntry(person)}
        name="answer"
        layout="cards"
        defaultValue={SAME}
        choices={[
          { id: SAME, label: WORDS.admitAs(person) },
          { id: OTHER, label: WORDS.otherPerson },
        ]}
      />
    </Dialog>
  );
}

/**
 * A registration's two acts, and no more: „Aufnehmen“ as `admission` says, and „Ablehnen“ asked first, since nothing
 * on the page takes a decline back. The question names whom it mails only where a mail goes, which is where the pupil
 * confirmed their address.
 */
export function RegistrierungActs({
  decided,
  admission,
  name,
  mailed,
}: {
  decided: Decided;
  admission: Admission;
  name: string;
  mailed: boolean;
}) {
  return (
    <>
      {admission.kind === "locked" ? (
        <Button
          variant="primary"
          label={COPY.shared.verb.admit}
          locked={admission.reason}
        />
      ) : admission.kind === "once" ? (
        <AdmitAtOnce
          decided={decided}
          spielerId={admission.spieler_id}
        />
      ) : (
        <AdmitAsked
          decided={decided}
          spielerId={admission.spieler_id}
          name={admission.name}
        />
      )}
      <ConfirmDialog
        verb="decline"
        subject={COPY.page.registrierung}
        consequence={WORDS.declineConsequence}
        {...(mailed ? { facts: [{ label: COPY.admin.facts.mailTo, value: { record: name } }] } : {})}
        tone="primary"
        onConfirm={() => declineRegistrierung({ ...decided, reason: null })}
        trigger={
          <Button
            variant="secondary"
            label={COPY.shared.verb.decline}
          />
        }
      />
    </>
  );
}
