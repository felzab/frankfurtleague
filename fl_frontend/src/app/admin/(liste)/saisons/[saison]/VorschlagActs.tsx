"use client";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";

import { COPY } from "@/core/copy";

import { adoptVorschlag, discardVorschlag } from "./adoptVorschlag";

import type { Copy } from "@/core/copy";

const SUBJECT = COPY.admin.overview.vorschlag;

/**
 * A club's proposed date on its row: „Übernehmen“ moves the fixture there and „Verwerfen“ keeps the date, each asked
 * once, its question naming the move or the date kept and the mail each sends, since neither is undone.
 */
export function VorschlagActs({
  id,
  adoptConsequence,
  discardConsequence,
}: {
  /** The club's confirmation row both acts write. */
  id: string;
  adoptConsequence: Copy;
  discardConsequence: Copy;
}) {
  return (
    <>
      <ConfirmDialog
        verb="adopt"
        subject={SUBJECT}
        consequence={adoptConsequence}
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
        consequence={discardConsequence}
        tone="danger"
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
