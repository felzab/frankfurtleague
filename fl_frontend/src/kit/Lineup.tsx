"use client";

import { useId, useState } from "react";

import { textOf } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { Button } from "./Button";
import { buttonLook, buttonPlaceholder } from "./buttonStyles";
import { card, columnHead, stacked } from "./cardStyles";
import { Tick } from "./Checkbox";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { RoleMark } from "./RoleMark";
import { RowActs } from "./RowActs";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { RoleMarkProps } from "./RoleMark";

/**
 * The block's look, which `Lineup` and its placeholder draw from: two cards, each a table of one-line rows at every
 * width, a phone's included, where the kit's `Table` stacks a row's acts under its words. The cards, the column heads
 * and the hairlines are the shared recipes'; the cells set as `Table`'s do, 12-px padding and rows 56 px high on a phone
 * and 52 on desktop, so a line-up reads as every other list of the kit.
 */
const lineup = tv({
  slots: {
    card: card().root(),
    // A block among an editor's boxes, so its head stands in the 16 px every box of the editor pads its head with.
    band: card().head({ class: "py-4" }),
    title: card().title(),
    count: card().count(),
    // `w-full`: the name's column takes the room the others leave; `overflow-x-auto` as every kit table's box.
    box: card().body({ class: "w-full overflow-x-auto" }),
    sheet: "w-full border-collapse text-sm",
    headRow: columnHead().rule(),
    head: columnHead().text(),
    row: `relative h-14 ${stacked()} lg:h-13`,
    // The name takes the room the facts leave and is cut with „…“ where it is longer.
    name: "w-full px-3 py-2",
    // A wrapping row, as `Table`'s name line: the name and its mark at the name's least width, 5 rem, grown to the
    // name and no further, so the chip stands after a short name, a long one is cut beside it down to that least, and
    // the chip takes the next line where the line's own room holds not both. The line's least is the name's, so the
    // facts beside it narrow the column to no less.
    nameLine: "flex min-w-20 flex-wrap items-center gap-2",
    // The name's track stops at the room the group has and counts nothing towards its least width; the mark keeps its
    // size after it.
    nameHead: "grid max-w-max min-w-0 grow basis-20 auto-cols-max grid-flow-col grid-cols-[minmax(0,max-content)] items-center gap-2",
    nameWords: "min-w-0 truncate",
    // The row's own line under its name, inside the row's height while it is one line. It wraps rather than being cut,
    // since a touch reaches no tooltip, and a word breaks anywhere, so the line never widens the name's column.
    line: "block text-xs wrap-anywhere",
    cell: "px-3 whitespace-nowrap",
    // The last cell, as narrow as the act it holds.
    end: "w-0 pe-3",
    acts: "flex items-center justify-end",
    // Nobody named yet: one muted sentence in a row of the list's height.
    empty: "flex min-h-14 items-center px-4 py-3 text-base text-fg-muted lg:min-h-13 lg:py-0 lg:text-sm",
  },
  variants: {
    align: {
      start: { head: "text-start", cell: "text-start" },
      // Figures and the tick stand centred under their heads, as a league table's figures do.
      centre: { head: "text-center", cell: "text-center" },
    },
    figures: { true: { cell: "font-numeric" } },
    // A shirt number's column: two figures and its padding at the least, as `Table`'s `count` width.
    count: { true: { head: "min-w-12" } },
    // Left out on a phone, whose row is the name, the number and the row's controls.
    desktop: { true: { head: "max-lg:hidden", cell: "max-lg:hidden" } },
    // A pupil the squad no longer holds.
    muted: { true: { row: "text-fg-muted" } },
    tone: {
      muted: { line: "text-fg-muted" },
      danger: { line: "text-danger" },
    },
  },
});

/**
 * A line-up as an editor's draft holds it, two of `useEditor`'s array values: the pupils it names, and those of them
 * who start. Each is a set, so its ids stand in one order, `lineupValue`'s, whatever order they were named in: the
 * editor compares arrays place by place, and a pupil named and taken out again must leave the draft as it was stored.
 */
export type LineupValue = { picked: ReadonlyArray<string>; starters: ReadonlyArray<string> };

const inOrder = (ids: Iterable<string>) => [...new Set(ids)].sort((one, other) => (one < other ? -1 : one > other ? 1 : 0));

/** A line-up's value in its one order, from the ids as a read serves them or a press leaves them; a starter is named. */
export function lineupValue(picked: Iterable<string>, starters: Iterable<string>): LineupValue {
  const named = inOrder(picked);
  return { picked: named, starters: inOrder(starters).filter((id) => named.includes(id)) };
}

/** How many start: the starters `value` names and the erased entries that started, as the write counts them. */
export const lineupStarters = (value: LineupValue, erased: ReadonlyArray<ErasedEntry>) =>
  value.starters.length + erased.filter((entry) => entry.starts).length;

const placeOf = (value: LineupValue, id: string) => (!value.picked.includes(id) ? "rest" : value.starters.includes(id) ? "starts" : "bench");

/**
 * How many pupils stand elsewhere in the draft than in the stored line-up, named, starting or neither: what an
 * editor's status line and its way back count as the line-up's changes (`useEditor`'s `countOf`), where the changed
 * fields are two at the most however many pupils moved.
 */
export function lineupMoves(stored: LineupValue, draft: LineupValue): number {
  return inOrder([...stored.picked, ...draft.picked]).filter((id) => placeOf(stored, id) !== placeOf(draft, id)).length;
}

/** One pupil of the squad, or one a stored line-up still names. */
export type LineupPlayer = {
  id: string;
  name: Words;
  /** The shirt number, which orders both lists; a pupil with none stands after the numbered ones. */
  nummer: number | null;
  /** From `lg` alone: a phone's row is the name, the number and the row's controls. */
  position?: Words;
  /** The role the pupil holds in the squad, the boxed letter after the name, which the block draws as `Table` does. */
  mark?: RoleMarkProps;
  chip?: ChipProps;
  /**
   * Registered after the season began: named only while fewer regular pupils than `startersMax` are, and no more of
   * them than that gap leaves.
   */
  nominee?: boolean;
  /**
   * The squad no longer holds the pupil, whom a stored line-up still names: the line saying so under the name. The
   * row leaves by its cross and comes back nowhere.
   */
  gone?: Copy;
};

/** Every word the block shows, the caller's. */
export type LineupWords = {
  /** The picked list's title and its table's name. */
  picked: Copy;
  /** The other list's: the squad's pupils the line-up does not name. */
  rest: Copy;
  name: Copy;
  nummer: Copy;
  position: Copy;
  /** The tick's column, which with the pupil's name is each tick's name. */
  starts: Copy;
  /** The word at a squad row's end. */
  pick: Copy;
  /** The cross's name, which its tooltip shows. */
  remove: Copy;
  /** In the picked list's place while it names nobody. */
  none: Copy;
  /** In the other list's place where the team has no squad. */
  noSquad: Copy;
  /** On the row of a tick pressed while `startersMax` pupils already start. */
  startersFull: Copy;
  /** Why a nominee cannot be named, and on a named nominee's row once the regular pupils leave no gap for them. */
  nomineeLocked: Copy;
  /** The name of an entry whose pupil was erased after the match kicked off: the placeholder a record keeps for a person gone. */
  anonymous: Words;
};

/** An entry of the stored line-up whose pupil was erased after the match kicked off: whether they started, and no person. */
export type ErasedEntry = { starts: boolean };

type LineupProps = {
  /** The squad, and every pupil `value` names: a named one the squad no longer holds carries `gone`. */
  players: ReadonlyArray<LineupPlayer>;
  value: LineupValue;
  /**
   * The stored entries naming an erased pupil, in their stored order: the club fielded them, so each stands in the
   * picked list read-only and counts as a regular pupil named and, where it started, a starter, as the write counts it;
   * no press reaches one and `value` never holds one, since every save keeps them as stored.
   */
  erased: ReadonlyArray<ErasedEntry>;
  onChange: (value: LineupValue) => void;
  /** How many start at the most, which is also how many regular pupils leave no place for a nominee. */
  startersMax: number;
  words: LineupWords;
  /**
   * Why nothing here can change as things stand, such as a fixture with no date: every act closed, each button
   * answering a press with this reason as the kit's locked acts do.
   */
  locked?: Copy;
  /** What the save refused of single pupils, by id: each on its row's own line, in the caller's hands when it goes. */
  refusals?: Readonly<Record<string, Copy>>;
};

/** A pupil with no number stands after the numbered ones, in the order given. */
const byNummer = (one: LineupPlayer, other: LineupPlayer) =>
  one.nummer === other.nummer ? 0 : one.nummer === null ? 1 : other.nummer === null ? -1 : one.nummer - other.nummer;

// How each column after the name sets, its head and its cells alike, in the block and in its placeholder.
const NUMMER = { align: "centre", figures: true, count: true } as const;
const POSITION = { align: "start", desktop: true } as const;
const TICK = { align: "centre" } as const;

/** A row's own line under its name: something to put right, or what the row is. */
type RowLine = { tone: "danger" | "muted"; text: Copy };

function NameCell({ player, nameId, line = null, lineId }: { player: LineupPlayer; nameId: string; line?: RowLine | null; lineId?: string }) {
  const s = lineup({ tone: line?.tone });
  return (
    <td className={s.name()}>
      <span className={s.nameLine()}>
        <span className={s.nameHead()}>
          <CutText
            id={nameId}
            text={textOf(player.name)}
            className={s.nameWords()}
          />
          {player.mark !== undefined && <RoleMark {...player.mark} />}
        </span>
        {player.chip !== undefined && <Chip {...player.chip} />}
      </span>
      {line !== null && (
        <span
          id={lineId}
          className={s.line()}>
          {line.text}
        </span>
      )}
    </td>
  );
}

/** The cells every row of either list holds after its name: the number, and from `lg` the position. */
function FactCells({ player }: { player: LineupPlayer }) {
  return (
    <>
      <td className={lineup(NUMMER).cell()}>{player.nummer !== null && formatNumber(player.nummer)}</td>
      <td className={lineup(POSITION).cell()}>{player.position !== undefined && textOf(player.position)}</td>
    </>
  );
}

function FactHeads({ words }: { words: Pick<LineupWords, "name" | "nummer" | "position"> }) {
  return (
    <>
      <th
        scope="col"
        className={lineup({ align: "start" }).head()}>
        {words.name}
      </th>
      <th
        scope="col"
        className={lineup(NUMMER).head()}>
        {words.nummer}
      </th>
      <th
        scope="col"
        className={lineup(POSITION).head()}>
        {words.position}
      </th>
    </>
  );
}

/**
 * A match's line-up as its club names it: everyone named in one list in shirt-number order, a tick alone in the
 * column headed by `words.starts` saying who starts and a cross taking the row out, over the squad's other pupils,
 * each row ending in the word that names its pupil. One line a row at every width, the name cut with „…“.
 *
 * At most `startersMax` start. Once they do, the open ticks dim and stay pressable: a press changes nothing, and
 * `words.startersFull` stands on that row's own line, inside the row's height, until the next change, as a refused
 * row's message does; a screen reader hears it as the tick's description. A nominee's word is locked with
 * `words.nomineeLocked` while the regular pupils named leave no gap. A regular pupil named over that gap takes no
 * nominee out: the nominees then named carry the same words on their rows, and the person chooses whom to take out.
 *
 * The value is the caller's, two of `useEditor`'s array values (`LineupValue`), so the editor's unsaved state, its
 * reset and its save hold a line-up as they hold any field; an entry whose pupil was erased stands outside it, read-only
 * under `words.anonymous`, its tick saying whether it started (`erased`). A row that leaves hands the focus to the row after it,
 * else the one before, else its card (`RowActs`).
 */
export function Lineup({ players, value, erased, onChange, startersMax, words, locked, refusals = {} }: LineupProps) {
  const id = useId();
  // The row whose tick was pressed with the starters complete; it says so while that still holds.
  const [pressed, setPressed] = useState<string | null>(null);

  const ordered = [...players].sort(byNummer);
  const picked = ordered.filter((player) => value.picked.includes(player.id));
  const rest = ordered.filter((player) => !value.picked.includes(player.id) && player.gone === undefined);
  const hasSquad = players.some((player) => player.gone === undefined);

  const isFull = lineupStarters(value, erased) >= startersMax;
  const nominees = picked.filter((player) => player.nominee === true).length;
  // An erased pupil holds no squad row, so nothing says they were nominated late: the write counts them regular.
  const gap = Math.max(0, startersMax - (picked.length + erased.length - nominees));

  const change = (named: Iterable<string>, starters: Iterable<string>) => {
    setPressed(null);
    onChange(lineupValue(named, starters));
  };
  const without = (ids: ReadonlyArray<string>, gone: string) => ids.filter((other) => other !== gone);
  const tick = (player: LineupPlayer, starts: boolean) => {
    if (starts && isFull) setPressed(player.id);
    else change(value.picked, starts ? [...value.starters, player.id] : without(value.starters, player.id));
  };

  const lineOf = (player: LineupPlayer, starts: boolean): RowLine | null => {
    const refusal = refusals[player.id];
    if (refusal !== undefined) return { tone: "danger", text: refusal };
    if (pressed === player.id && isFull && !starts) return { tone: "danger", text: words.startersFull };
    if (player.nominee === true && nominees > gap) return { tone: "danger", text: words.nomineeLocked };
    return player.gone === undefined ? null : { tone: "muted", text: player.gone };
  };

  const s = lineup();
  const startsId = `${id}-starts`;
  const fullId = `${id}-full`;
  return (
    <>
      <section
        data-kit-focus="home"
        className={s.card()}>
        <div className={s.band()}>
          <h2 className={s.title()}>{words.picked}</h2>
          <span className={s.count()}>{picked.length + erased.length}</span>
        </div>
        <div className={s.box()}>
          {picked.length + erased.length === 0 ? (
            <p className={s.empty()}>{words.none}</p>
          ) : (
            <table
              aria-label={words.picked}
              className={s.sheet()}>
              <thead>
                <tr className={s.headRow()}>
                  <FactHeads words={words} />
                  <th
                    id={startsId}
                    scope="col"
                    className={lineup(TICK).head()}>
                    {words.starts}
                  </th>
                  {/* The crosses' column names nothing, so its head is no header cell. */}
                  <td className={s.head()} />
                </tr>
              </thead>
              <tbody>
                {picked.map((player) => {
                  const starts = value.starters.includes(player.id);
                  const line = lineOf(player, starts);
                  const nameId = `${id}-${player.id}`;
                  const lineId = `${nameId}-line`;
                  // Dimmed as a closed act is and still pressed, so the press can be answered on the row.
                  const isOpenTick = isFull && !starts;
                  return (
                    <tr
                      key={player.id}
                      data-kit-row
                      className={lineup({ muted: player.gone !== undefined }).row()}>
                      <NameCell
                        player={player}
                        nameId={nameId}
                        line={line}
                        lineId={lineId}
                      />
                      <FactCells player={player} />
                      <td className={lineup(TICK).cell()}>
                        <Tick
                          aria-labelledby={`${startsId} ${nameId}`}
                          aria-describedby={line === null ? (isOpenTick ? fullId : undefined) : lineId}
                          isSelected={starts}
                          isDisabled={locked !== undefined || player.gone !== undefined}
                          locked={isOpenTick}
                          onChange={(isSelected) => tick(player, isSelected)}
                        />
                      </td>
                      <td className={s.end()}>
                        <RowActs className={s.acts()}>
                          <Button
                            icon="close"
                            label={words.remove}
                            aria-describedby={nameId}
                            locked={locked}
                            onPress={() => change(without(value.picked, player.id), without(value.starters, player.id))}
                          />
                        </RowActs>
                      </td>
                    </tr>
                  );
                })}
                {/* After the numbered pupils, as a pupil without a number stands, in their stored order: no person
                    stands behind one, so its place names it, and no act reaches it. */}
                {erased.map((entry, place) => {
                  const nameId = `${id}-erased-${String(place)}`;
                  return (
                    <tr
                      key={nameId}
                      className={lineup({ muted: true }).row()}>
                      <NameCell
                        player={{ id: nameId, name: words.anonymous, nummer: null }}
                        nameId={nameId}
                      />
                      <FactCells player={{ id: nameId, name: words.anonymous, nummer: null }} />
                      <td className={lineup(TICK).cell()}>
                        <Tick
                          aria-labelledby={`${startsId} ${nameId}`}
                          isSelected={entry.starts}
                          isDisabled
                          onChange={() => undefined}
                        />
                      </td>
                      <td className={s.end()} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* What an open tick is described by before any press, as a locked act's reason stands unseen for its button. */}
        {isFull && (
          <span
            id={fullId}
            hidden>
            {words.startersFull}
          </span>
        )}
      </section>
      <section
        data-kit-focus="home"
        className={s.card()}>
        <div className={s.band()}>
          <h2 className={s.title()}>{words.rest}</h2>
          <span className={s.count()}>{rest.length}</span>
        </div>
        {!hasSquad && (
          <div className={s.box()}>
            <p className={s.empty()}>{words.noSquad}</p>
          </div>
        )}
        {rest.length > 0 && (
          <div className={s.box()}>
            <table
              aria-label={words.rest}
              className={s.sheet()}>
              <thead>
                <tr className={s.headRow()}>
                  <FactHeads words={words} />
                  <td className={s.head()} />
                </tr>
              </thead>
              <tbody>
                {rest.map((player) => {
                  const nameId = `${id}-${player.id}`;
                  return (
                    <tr
                      key={player.id}
                      data-kit-row
                      className={s.row()}>
                      <NameCell
                        player={player}
                        nameId={nameId}
                      />
                      <FactCells player={player} />
                      <td className={s.end()}>
                        <RowActs className={s.acts()}>
                          <Button
                            variant="secondary"
                            label={words.pick}
                            aria-describedby={nameId}
                            locked={locked ?? (player.nominee === true && nominees >= gap ? words.nomineeLocked : undefined)}
                            onPress={() => change([...value.picked, player.id], value.starters)}
                          />
                        </RowActs>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type WaitWords = Pick<LineupWords, "picked" | "rest" | "name" | "nummer" | "position" | "starts" | "pick">;

/** One list's rows while the line-up is read, at the rows' height: `starts` the tick's head, `end` what a row ends in. */
function RowsPlaceholder({ words, starts, rows, end }: { words: WaitWords; starts?: Copy; rows: number; end: ReactElement }) {
  const s = lineup();
  return (
    <table className={s.sheet()}>
      <thead>
        <tr className={s.headRow()}>
          <FactHeads words={words} />
          {starts !== undefined && <th className={lineup(TICK).head()}>{starts}</th>}
          <td className={s.head()} />
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, index) => (
          <tr
            key={index}
            className={s.row()}>
            <td className={s.name()}>
              <PlaceholderLine
                textClass=""
                widthClass="w-1/2"
              />
            </td>
            <td className={lineup(NUMMER).cell()}>
              <PlaceholderLine
                textClass=""
                widthClass="mx-auto w-4"
              />
            </td>
            <td className={lineup(POSITION).cell()}>
              <PlaceholderLine
                textClass=""
                widthClass="w-20"
              />
            </td>
            {starts !== undefined && (
              <td className={lineup(TICK).cell()}>
                <span className={placeholderBar("mx-auto block size-4.5")} />
              </td>
            )}
            <td className={s.end()}>
              <span className={s.acts()}>{end}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The block while the line-up is read: its two cards with their titles and column heads, a bar where each count will
 * stand, and as many rows at the rows' height as the page states for each list, the tick, the cross and the squad
 * rows' word as bars of their size. A picked list of none draws the row its sentence will stand in, and a squad
 * list of none its head alone, as the block does.
 */
export function LineupPlaceholder({ words, picked, rest }: { words: WaitWords; picked: number; rest: number }) {
  const s = lineup();
  // Inline, so its line keeps the count's baseline, which the band aligns on, as a fold's head does (`ReadFolds.tsx`).
  const count = (
    <span className={s.count()}>
      <span className={placeholderBar("inline-block h-3 w-4 align-middle")} />
    </span>
  );
  return (
    <>
      <div className={s.card()}>
        <div className={s.band()}>
          <span className={s.title()}>{words.picked}</span>
          {count}
        </div>
        <div className={s.box()}>
          {picked === 0 ? (
            <div className={s.empty()}>
              <PlaceholderLine
                textClass=""
                widthClass="w-1/2"
              />
            </div>
          ) : (
            <RowsPlaceholder
              words={words}
              starts={words.starts}
              rows={picked}
              end={<span className={buttonLook({ look: "placeholder", class: "w-8 px-0 pointer-coarse:w-10" })} />}
            />
          )}
        </div>
      </div>
      <div className={s.card()}>
        <div className={s.band()}>
          <span className={s.title()}>{words.rest}</span>
          {count}
        </div>
        {rest > 0 && (
          <div className={s.box()}>
            <RowsPlaceholder
              words={words}
              rows={rest}
              end={<span className={buttonPlaceholder()}>{words.pick}</span>}
            />
          </div>
        )}
      </div>
    </>
  );
}
