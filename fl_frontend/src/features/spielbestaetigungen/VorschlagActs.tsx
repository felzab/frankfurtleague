"use client";

import { COPY } from "@/core/copy/shared";
import { ConfirmDialog } from "@/kit/ConfirmDialog";
import { useLocked } from "@/kit/draftUnsaved";

import { adoptVorschlag, discardVorschlag } from "./adoptVorschlag";

import type { Copy } from "@/core/copy";
import type { Fact } from "@/kit/Facts";

/** One question's words: its short sentence, and the facts it rests on. */
type Question = { consequence: Copy; facts: ReadonlyArray<Fact> };

const SUBJECT = COPY.spielplan.vorschlag;

/**
 * A club's proposed date on its row: „Übernehmen“ moves the fixture there and „Verwerfen“ keeps the date, each asked
 * once, its question naming the move or the date kept and whom each mails, since neither is undone. In the match
 * editor both stand locked while its draft holds unsaved changes, as every act inside an editor does (`useLocked`):
 * moved by „Übernehmen“, the match would turn the draft's save away as stale.
 */
export function VorschlagActs({
  id,
  adopt,
  discard,
}: {
  /** The club's confirmation row both acts write. */
  id: string;
  adopt: Question;
  discard: Question;
}) {
  const locked = useLocked(undefined);
  const lock = locked === undefined ? {} : { locked };
  return (
    <>
      <ConfirmDialog
        question={{ verb: "adopt", subject: SUBJECT, consequence: adopt.consequence, facts: adopt.facts, tone: "primary" }}
        onConfirm={() => adoptVorschlag({ id })}
        trigger={{ label: COPY.shared.verb.adopt, variant: "primary", ...lock }}
      />
      <ConfirmDialog
        // Keeping the stored date destroys nothing, so its question asks in the neutral primary, as „Übernehmen“'s does.
        question={{ verb: "discard", subject: SUBJECT, consequence: discard.consequence, facts: discard.facts, tone: "primary" }}
        onConfirm={() => discardVorschlag({ id })}
        trigger={{ label: COPY.shared.verb.discard, ...lock }}
      />
    </>
  );
}
