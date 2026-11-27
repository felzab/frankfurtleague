import { requires } from "@/core/action";
import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import {
  SpielbestaetigungenPostSchiedsrichterAnswerBody,
  spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneMax,
} from "@/core/generated/zod/inputs";
import { Dialog } from "@/kit/Dialog";
import { PressAct } from "@/kit/PressAct";
import { TextField } from "@/kit/TextField";

import { agreeEinteilung, declineEinteilung } from "./answerEinteilung";

import type { Words } from "@/core/copy";

const TITLE = COPY.shared.withObject(AREA_COPY.schiedsrichter.einsatz, "decline");

/**
 * A booking still to answer, on its row in the card „Termine“: „Zusagen“ at once, its answer a toast as the row
 * leaves the card, and „Ablehnen“ in the dialog asking for the reason, the game named under its title. Neither takes
 * the passkey touch. Both name the row's own confirmation, which is all either posts of the row.
 */
export function EinteilungActs({
  id,
  spiel,
}: {
  /** The confirmation row both answers name. */
  id: string;
  spiel: Words;
}) {
  return (
    <>
      <PressAct
        act={{ verb: "agree" }}
        run={agreeEinteilung}
        payload={{ id }}
      />
      <Dialog
        title={TITLE}
        act={{ verb: "decline" }}
        // A refusal is the dialog's destroying act: the red fill every destroying press takes.
        tone="danger"
        lead={spiel}
        run={declineEinteilung}
        carry={{ id }}
        trigger={{ label: COPY.shared.verb.decline }}>
        <TextField
          label={COPY.shared.reason}
          // The name `declineEinteilung` reads the reason by.
          name="reason"
          kind="paragraph"
          isRequired={requires(SpielbestaetigungenPostSchiedsrichterAnswerBody.shape.reason, "")}
          maxLength={spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneMax}
          description={COPY.shared.noNames}
        />
      </Dialog>
    </>
  );
}
