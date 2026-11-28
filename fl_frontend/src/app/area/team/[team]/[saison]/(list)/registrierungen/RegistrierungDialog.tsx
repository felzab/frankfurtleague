"use client";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { Dialog } from "@/kit/Dialog";
import { Facts } from "@/kit/Facts";
import { RadioGroup } from "@/kit/RadioGroup";

import { admitRegistrierung, declineRegistrierung } from "./decideRegistrierung";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Fact } from "@/kit/Facts";
import type { HeldOpen } from "@/kit/useOpenUntilHidden";

const WORDS = AREA_COPY.team.registrierung;

/** The registration a dialog decides, whose own team the backend judges the seat against. */
type Decided = { registrierung_id: string };

/**
 * What „Aufnehmen“ does: nothing, with its reason, while the registration cannot be admitted; at once, into the stored
 * person its address names or a new one; or, where that person's details differ, after the team answers whether the
 * registration is that person.
 */
export type Admission =
  { kind: "locked"; reason: Copy } | { kind: "once"; spieler_id: string | null } | { kind: "asks"; spieler_id: string; name: string };

/** One pending registration as its dialog shows it: the pupil's name, the line of its notes, its facts and its admission. */
export type RegistrierungEntry = { decided: Decided; name: string; notes?: Copy; facts: readonly Fact[]; admission: Admission };

/** The same-person question's two answers, by the radio's value. */
const SAME = "same";
const OTHER = "other";

/**
 * „Aufnehmen“ as the entry's admission says: an admission done says „Aufgenommen“ in the dialog's toast, and a wrong
 * one is undone in the Kader by „Austragen“; where the team is asked, the other person's answer declines the
 * registration, which its toast says, and the pupil's mail asks them to register under an address of their own.
 */
async function admitted({ decided, admission }: RegistrierungEntry, formData: FormData): Promise<ActionAnswer> {
  // The locked act sends nothing; the reason answers all the same should a press reach here.
  if (admission.kind === "locked") return { ok: false, reason: admission.reason };
  if (admission.kind === "asks" && formData.get("answer") === OTHER) {
    const declined = await declineRegistrierung({ ...decided, reason: "other_person" });
    // The dialog's act is „Aufnehmen“, whose done word would name the act this answer did not do: the decline's own
    // word stands in, and closes itself as the „Ablehnen“ row's does.
    return declined.ok ? { ...declined, done: COPY.shared.toast.done.decline } : declined;
  }
  return admitRegistrierung({ ...decided, spieler_id: admission.spieler_id });
}

/**
 * A pending registration's dialog, titled by the pupil's name as the Kader's row dialog is: every fact the registration
 * holds, „Aufnehmen“ as its act, and „Ablehnen“ in its row, asked first, since nothing on the page takes a decline back.
 * Where the pupil's address is a stored person's under other details, the team answers whose registration it is, the
 * known person standing chosen, the answer that keeps a returning pupil from entering the league twice.
 */
export function RegistrierungDialog({ entry, open }: { entry: RegistrierungEntry; open: HeldOpen }) {
  const { decided, name, notes, facts, admission } = entry;
  const person = admission.kind === "asks" ? { record: admission.name } : null;
  return (
    <Dialog
      title={{ record: name }}
      {...(notes === undefined ? {} : { lead: notes })}
      act={{ verb: "admit" }}
      run={(formData) => admitted(entry, formData)}
      // Its one box, the same-person answer, is the dialog's own, which no lane reads: it always holds a choice.
      rules={{}}
      {...(admission.kind === "locked" ? { locked: admission.reason } : {})}
      open={open}
      danger={{
        name: COPY.shared.withObject(COPY.page.registrierung, "decline"),
        consequence: WORDS.declineConsequence,
        confirm: {
          verb: "decline",
          subject: COPY.page.registrierung,
          consequence: WORDS.declineConsequence,
          // Whose registration it is, mailed or not: a decline names its pupil, which the dialog's title does no longer.
          facts: [{ label: COPY.shared.name, value: { record: name } }],
          // A refusal destroys what was sent: the one outlined danger look, its question's press the red fill.
          tone: "danger",
          onConfirm: () => declineRegistrierung({ ...decided, reason: null }),
        },
      }}>
      <Facts facts={facts} />
      {person !== null && (
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
      )}
    </Dialog>
  );
}
