"use client";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";

import { COPY } from "@/core/copy";

import { adoptVorschlag, discardVorschlag } from "./adoptVorschlag";

import type { Copy } from "@/core/copy";
import type { Fact } from "@/kit/Facts";

/** One question's words: its short sentence, and the facts it rests on. */
type Question = { consequence: Copy; facts: ReadonlyArray<Fact> };

const SUBJECT = COPY.admin.overview.vorschlag;

/**
 * A club's proposed date on its row: „Übernehmen“ moves the fixture there and „Verwerfen“ keeps the date, each asked
 * once, its question naming the move or the date kept and whom each mails, since neither is undone.
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
  return (
    <>
      <ConfirmDialog
        verb="adopt"
        subject={SUBJECT}
        consequence={adopt.consequence}
        facts={adopt.facts}
        tone="primary"
        onConfirm={() => adoptVorschlag({ id })}
        trigger={
          <Button
            variant="primary"
            label={COPY.shared.verb.adopt}
          />
        }
      />
      <ConfirmDialog
        verb="discard"
        subject={SUBJECT}
        consequence={discard.consequence}
        facts={discard.facts}
        // Keeping the stored date destroys nothing, so its question asks in the neutral primary, as „Übernehmen“'s does.
        tone="primary"
        onConfirm={() => discardVorschlag({ id })}
        trigger={
          <Button
            variant="secondary"
            label={COPY.shared.verb.discard}
          />
        }
      />
    </>
  );
}
