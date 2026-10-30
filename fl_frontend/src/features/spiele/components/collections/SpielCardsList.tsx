"use client";

import { useState } from "react";

import { useSaisonId } from "@/shared/hooks/useSaisonHref";

import { adminSpielEditHref } from "../../utils";
import { SpielDetailsModal } from "../modals/SpielDetailsModal";
import { SpielCard } from "../ui/SpielCard";

import type { BerichtChip } from "@/features/spielberichte/utils";
import type { SaisonBestaetigungen } from "@/features/spielbestaetigungen/types";
import type { FeedbackTone } from "@/shared/components/ui/badges";
import type { FLSpiel } from "../../types";

/** What a note beside a card says, in one tone for the list: a fault is an error, a proposal or a silence is not. */
export type SpielCardNotes = {
  tone: Exclude<FeedbackTone, "success">;
  /**
   * Keyed by `spiel_id`. A map rather than a field on the fixture, each note being derived over the
   * whole season and arriving beside the matches rather than inside them.
   */
  bySpielId: ReadonlyMap<string, readonly string[]>;
};

// Spelled whole, never assembled, so Tailwind finds every class; the stems take the note's border.
const NOTE_TONE_CLASSES: Record<SpielCardNotes["tone"], { note: string; stem: string }> = {
  danger: { note: "border-danger/30 bg-danger/5 text-danger-strong", stem: "bg-danger/30" },
  warning: { note: "border-warning/30 bg-warning/5 text-warning-strong", stem: "bg-warning/30" },
  info: { note: "border-info/30 bg-info/5 text-info-strong", stem: "bg-info/30" },
};

/** `isAdmin` gives every card an edit link, a URL being all the admin variant now needs. */
export function SpielCardsList({
  spiele,
  today,
  isAdmin = false,
  notes,
  bestaetigungen,
  berichtChipsBySpielId,
  isFinishedSaison,
}: {
  spiele: FLSpiel[];
  today: string;
  isFinishedSaison: boolean;
  isAdmin?: boolean;
  notes?: SpielCardNotes;
  /** The season's confirmation rows, an administrator's read the card shows only beside its edit link. */
  bestaetigungen?: SaisonBestaetigungen;
  /** Keyed by `spiel_id`, for the notes' reason: a report's state arrives beside the matches, never inside them. */
  berichtChipsBySpielId?: ReadonlyMap<string, BerichtChip>;
}) {
  const [selectedSpiel, setSelectedSpiel] = useState<FLSpiel | null>(null);
  const saisonId = useSaisonId();

  return (
    <div className="contents">
      {spiele.map((spielData) => {
        const sentences = notes?.bySpielId.get(spielData.id);
        const hasNotes = notes !== undefined && sentences !== undefined && sentences.length > 0;
        const card = (
          <SpielCard
            key={hasNotes ? undefined : spielData.id}
            spielData={spielData}
            today={today}
            isFinishedSaison={isFinishedSaison}
            onOpenInfoModal={() => setSelectedSpiel(spielData)}
            adminEditHref={isAdmin ? adminSpielEditHref(spielData.id, saisonId) : undefined}
            asListitem={!hasNotes}
            confirmations={bestaetigungen}
            berichtChip={berichtChipsBySpielId?.get(spielData.id)}
          />
        );

        if (!hasNotes) return card;

        const tone = NOTE_TONE_CLASSES[notes.tone];

        // The wrapper carries `role="listitem"` and the card gives its own up, or the fixture
        // announces twice. A real element, because the cascade staggers by `:nth-child`.
        return (
          <div
            key={spielData.id}
            role="listitem"
            className="flex w-full flex-col">
            <ul className={`flex w-full flex-col gap-y-1 rounded-xl border px-3.5 py-2.5 fluid-xxs font-semibold ${tone.note}`}>
              {sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
            {/* The connectors: one short stem at each end of the note, mirrored,
                so the note and the card read as one drawn shape rather than a box floating over an
                unrelated card. */}
            <div
              aria-hidden="true"
              className="flex shrink-0 flex-row justify-between px-7">
              <span className={`h-3 w-px ${tone.stem}`} />
              <span className={`h-3 w-px ${tone.stem}`} />
            </div>
            {/* `*:grow` stretches the card to the cell's remaining height, which is what the grid's
                own align-stretch did for it while it was the listitem — so a noted card and its
                unnoted neighbour still bottom-align in one row. */}
            <div className="flex min-h-0 grow flex-col *:grow">{card}</div>
          </div>
        );
      })}

      {/* Guarded, so a list never clicked mounts no overlay: this is instantiated once per
          collection, and mounting unconditionally would put a dialog tree plus its react-aria
          machinery on first paint at each. The accepted cost is HeroUI's exit transition. */}
      {selectedSpiel && (
        <SpielDetailsModal
          spielData={selectedSpiel}
          today={today}
          isFinishedSaison={isFinishedSaison}
          isOpen={true}
          onClose={() => setSelectedSpiel(null)}
        />
      )}
    </div>
  );
}
