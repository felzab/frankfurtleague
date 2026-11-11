"use client";

import { Lineup, lineupMoves, lineupStarters, lineupValue } from "@/kit/Lineup";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";

import { STARTERS_MAX } from "../../constants";
import { REFUSED_ROW } from "../../payload";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLAufstellungEntry } from "@/core/generated/client/types";
import type { ErasedEntry, LineupPlayer, LineupValue, LineupWords } from "@/kit/Lineup";
import type { EditorSave } from "@/kit/useEditor";

/** What a line-up's save is handed: the fixture, the version the editor was read at, and the half of the line-up it changed. */
type AufstellungSave = EditorSave<LineupValue, number | null>;

/** What the line-up's editor is handed, at whichever address it stands. */
export type AufstellungEditing = {
  /**
   * The line-up as read: the fixture's id, the stored `version`, `null` where none is stored, its entries naming a pupil,
   * and those whose pupil was erased since, which no save sends and every save keeps.
   */
  aufstellung: { id: string; version: number | null; spieler: ReadonlyArray<FLAufstellungEntry>; erased: ReadonlyArray<ErasedEntry> };
  players: ReadonlyArray<LineupPlayer>;
  words: LineupWords;
  /** Why nobody can be named as the fixture stands, such as its having no day or hour yet. */
  locked?: Copy;
  save: (change: AufstellungSave) => Promise<ActionAnswer<number>>;
};

/**
 * One club's line-up for one fixture as an editor holds it, for the team's page and the administrator's alike: the
 * editor over the stored line-up, counting the pupils moved; the bar's words, the starters of the most that may start;
 * and the block, everyone named in one list with the starters ticked over the squad's other pupils. It knows nothing of
 * whose address it stands at: the page's own editor places the three in its `EditorPage` and hands it the save.
 */
export function useAufstellungEditor({ aufstellung, players, words, locked, save }: AufstellungEditing) {
  const record = {
    id: aufstellung.id,
    version: aufstellung.version,
    // In the block's one order, or a pupil named and taken out again would leave the draft counted as changed.
    values: lineupValue(
      aufstellung.spieler.map((entry) => entry.spieler_id),
      aufstellung.spieler.filter((entry) => entry.starts).map((entry) => entry.spieler_id),
    ),
  };
  const editor = useEditor<LineupValue, number | null>(record, save, { countOf: lineupMoves });
  const { draft, set } = editor;
  // The pupils the save refused, each on their own row, while the refusal stands over the draft it was sent with.
  const refusals = Object.fromEntries(
    Object.entries(editor.fieldErrors ?? {}).flatMap(([box, text]) =>
      box.startsWith(REFUSED_ROW) ? [[box.slice(REFUSED_ROW.length), text]] : [],
    ),
  );

  return {
    editor,
    // The starters alone: beside the count of moves it fits a phone's bar, where the longer line pushes the count out.
    barText: COPY.area.team.aufstellung.startelfCount(lineupStarters(draft, aufstellung.erased), STARTERS_MAX),
    block: (
      <Lineup
        players={players}
        value={draft}
        erased={aufstellung.erased}
        onChange={(next) => {
          set("picked", next.picked);
          set("starters", next.starters);
        }}
        startersMax={STARTERS_MAX}
        words={words}
        locked={locked}
        refusals={refusals}
      />
    ),
  };
}
