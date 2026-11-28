import "server-only";

import { boxRulesOf } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatList, timeOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";

import { enterZusage } from "./enterZusage";
import { VorschlagActs } from "./VorschlagActs";
import { ZusageDialog } from "./ZusageDialog";

import type { FLSpielbestaetigungAppointment, FLSpielRecipientSchiedsrichter, FLSpielRecipientTeam } from "@/core/generated/client/types";
import type { OpenParty } from "./ZusageDialog";

const WORDS = SERVER_COPY.overview;

type Recipients = readonly (FLSpielRecipientTeam | FLSpielRecipientSchiedsrichter)[];

/** A club's standing proposal as the backend serves it beside its row: its slot, and whom each act on it mails. */
type Proposal = {
  vorschlag: FLSpielbestaetigungAppointment;
  adoption_recipients: Recipients;
  discard_recipients: Recipients;
};

/**
 * The question's „Mail an“ fact: the parties the backend mails of the act, which it serves beside the row each by the
 * name its own record holds, in their names' order as the match editor's save question lists them, none where the act
 * mails nobody, so the question names no mail that is never sent.
 */
function mailTo(recipients: Recipients) {
  const names = recipients.map(({ name }) => name).toSorted((one, other) => one.localeCompare(other, "de"));
  return names.length === 0 ? [] : [{ label: ADMIN_COPY.facts.mailTo, value: { record: formatList(names) } }];
}

/**
 * „Zusage eintragen“ for the parties still to answer, from the Übersicht's row of their fixture and from each party's
 * row in the match editor alike, so both pages ask the same.
 */
export function zusageAct(parties: readonly [OpenParty, ...OpenParty[]]) {
  return (
    <ZusageDialog
      parties={parties}
      rules={boxRulesOf(enterZusage)}
    />
  );
}

/**
 * „Übernehmen“ and „Verwerfen“ on a club's standing proposal, the fixture standing at `slot`: each question names the
 * move or the date kept and whom the act mails, the same on the Übersicht and in the match editor.
 */
export function vorschlagActs(id: string, slot: { date: string | null; time: string | null }, proposal: Proposal) {
  const from = COPY.spielplan.when(dayOf(slot.date), timeOf(slot.time));
  const to = COPY.spielplan.when(dayOf(proposal.vorschlag.date), timeOf(proposal.vorschlag.time));
  return (
    <VorschlagActs
      id={id}
      adopt={{
        consequence: WORDS.adoptConsequence,
        facts: [
          { label: COPY.shared.facts.before, value: from },
          { label: COPY.shared.facts.after, value: to },
          ...mailTo(proposal.adoption_recipients),
        ],
      }}
      discard={{
        consequence: WORDS.discardConsequence,
        facts: [
          { label: COPY.spielplan.appointment, value: from },
          { label: COPY.spielplan.vorschlag, value: to },
          ...mailTo(proposal.discard_recipients),
        ],
      }}
    />
  );
}
