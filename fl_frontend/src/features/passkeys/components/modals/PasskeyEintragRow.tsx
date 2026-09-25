"use client";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";

import type { PasskeyEintrag } from "../../types";

// `timeZone` is what carries this, as it carries `fl_frontend/src/shared/utils/format.ts :: SPIEL_DATE_FORMATTER`:
// the image runs UTC and the reader does not, so an enrolment made at night lands on the wrong day.
const STAMP = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "short" });

/** What the row calls a passkey whose AAGUID names no make — every Apple one, and any unknown model. */
const UNBEKANNT = "Unbekannter Passkey";

/**
 * Both halves of what deleting one costs, in the armed reveal: the session ending is not derivable
 * from a control labelled „Löschen“, and it reaches the reader's other devices rather than this one.
 */
const FOLGE = "Dieser Passkey wird gelöscht. Alle anderen Geräte werden dabei abgemeldet.";

/**
 * Its own component so each row holds its own armed state (`docs/frontend/spec.md :: I37`): one
 * state shared across the list would leave a second row one press from a removal armed on the first.
 */
export function PasskeyEintragRow({
  eintrag,
  reason,
  onRemove,
}: {
  eintrag: PasskeyEintrag;
  /** What closes the deletion, or `null`. The last row's refusal is the list's to judge, not the row's. */
  reason: string | null;
  onRemove: (id: string) => Promise<void>;
}) {
  const twoPress = useTwoPressConfirm();
  const { isConfirming, press } = twoPress;

  return (
    <li className="border-border flex flex-col gap-3 border-b py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="fluid-sm text-foreground font-bold break-words">{eintrag.label ?? UNBEKANNT}</span>
        <span className="muted-hint">{STAMP.format(new Date(eintrag.createdAt))}</span>
      </div>

      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-sm text-foreground text-pretty">{FOLGE}</p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow confirm={twoPress}>
        <ConfirmPressButton
          confirm={twoPress}
          reason={reason}
          resting="Löschen"
          armed="Ja, Passkey löschen"
          running="Löscht..."
          icon={
            <TrashBin
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
          }
          onPress={() => press(() => onRemove(eintrag.id))}
        />
      </ConfirmActionRow>
    </li>
  );
}
