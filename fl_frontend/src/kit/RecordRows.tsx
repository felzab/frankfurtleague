"use client";

import { useEffect, useId, useRef, useState } from "react";

import { FocusScope, useFocusManager } from "react-aria/FocusScope";

import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { smallCaps, stacked } from "./cardStyles";
import { messageLine } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { Icon } from "./Icon";
import { useFocusHome } from "./RowActs";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EditorRow } from "./useEditor";

/** What a row's cell hands its control. */
type RowControl<Row extends EditorRow> = {
  row: Row;
  /** The box's name, the list's, the row's index and the field, `scorers.2.minute`, by which a kit field takes its refusal. */
  name: string;
  /** The cell's label, which names the control to a screen reader alone (`labelHidden`). */
  label: Copy;
  /** The served refusal of the box, for a control posting no form value, which takes it as its `errorMessage`. */
  error: Copy | undefined;
  /** Sets fields of this row, several where one choice empties another, as a goal's side empties its player. */
  change: (patch: Partial<Row>) => void;
};

/**
 * One cell of every row: the field it edits, the name its control carries for a screen reader, and the control, a
 * kit field with its label hidden. No label stands over a cell at any width: the row's own label counts the row, and
 * each control shows what it holds.
 */
type RowCell<Row extends EditorRow> = {
  field: keyof Row & string;
  label: Copy;
  control: (cell: RowControl<Row>) => ReactNode;
};

/**
 * A row's cells by their place. A phone's first line holds `lead`, a short choice heading the row, and `figure`, a
 * short field; its second `main`, the long field, and `beside`, a toggle at its end; `below` takes a third line, as a
 * card's colour does. From desktop up they stand on one line in this order, `beside` or `below` last.
 */
export type RowCells<Row extends EditorRow> = { lead: RowCell<Row>; figure: RowCell<Row>; main: RowCell<Row> } & (
  { beside?: RowCell<Row>; below?: never } | { below: RowCell<Row>; beside?: never }
);

/**
 * A later cell's message goes while an earlier one says something: a row has one line, and its first refused field
 * speaks on it, as a box shows the first refusal it meets.
 */
const FIRST_MESSAGE = "[&>:has([data-kit-message]:not(:empty))~*_[data-kit-message]]:hidden";

/*
 * The rows' whole look, in the one place a ruling changes it: the grid, the hairline between rows, the row's label and
 * every gap, each 4, 8 or 16 px.
 */
const recordRows = tv({
  slots: {
    // Edge to edge in its box, which holds it unpadded (`Section`'s `list`): the rows, then the foot.
    root: "grid w-full min-w-0",
    // The columns every row shares, so a field stands at one x in every row. A phone's first line: the lead, the
    // figure, and the remove control at the row's end. From desktop up one line: the lead, the figure, the main field
    // up to a form field's cap, the trailing cell taking the room that is left, the remove control. The cap is
    // counted in the field's own letters, so the grid is set in the field's text.
    grid: "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 text-sm lg:grid-cols-[auto_auto_minmax(0,var(--container-field))_1fr_auto] lg:gap-x-3 pointer-coarse:text-base",
    // A row brings the box's 16-px insets itself, so the hairline over it reaches the box's edges. Its label and its
    // lines stand 8 px apart, 16 px under the hairline. Under the last line the row's message line is always there:
    // 4 px under the fields, 16 px tall, 4 px over the next hairline, which the 24 px of padding hold, so a message
    // appearing moves nothing. Each field's own line is laid there, out of the row's flow, so a field keeps its own
    // check and its own description for a screen reader. It hangs from its top, so a message too long for one line
    // runs on into the empty room over the next row rather than up over its own row's fields.
    row: `relative col-span-full grid grid-cols-subgrid items-center gap-y-2 px-4 pt-4 pb-6 ${stacked()} [&_[data-kit-message]]:absolute [&_[data-kit-message]]:inset-x-4 [&_[data-kit-message]]:top-full [&_[data-kit-message]]:-mt-4 [&_[data-kit-message]]:-translate-y-1 ${FIRST_MESSAGE}`,
    // The label counting the row, „Tor 1“, on the kit's label rung, the same at every width.
    label: smallCaps({ class: "col-span-full row-start-1" }),
    lead: "col-start-1 row-start-2",
    figure: "col-start-2 row-start-2",
    // A phone's second line, the main field and what stands beside it; from desktop up its two cells are the row's own.
    second: `col-span-full row-start-3 grid items-center gap-x-2 lg:contents ${FIRST_MESSAGE}`,
    main: "lg:col-start-3 lg:row-start-2",
    beside: "lg:col-start-4 lg:row-start-2",
    below: "col-span-full row-start-4 lg:col-span-1 lg:col-start-4 lg:row-start-2",
    // The cross ends with the fields' edge: its button, as wide as a control is tall, reaches past the edge by the
    // room it keeps around its 16-px glyph, 8 px with a mouse and 12 px on a touch screen.
    remove: "col-start-3 row-start-2 -me-2 justify-self-end lg:col-start-5 pointer-coarse:-me-3",
    // The add control in the box's padding, under the hairline that parts it from the last row. The list's own
    // message line hangs in the padding under the control, so its refusal appearing moves nothing.
    foot: `relative grid justify-items-start p-4 ${stacked()}`,
    line: messageLine({ tone: "error", class: "absolute inset-x-4 bottom-0" }),
  },
  variants: {
    // The main field shares its line with what stands beside it, or takes the line whole.
    beside: {
      true: { second: "grid-cols-[minmax(0,1fr)_auto]" },
      false: { second: "grid-cols-[minmax(0,1fr)]" },
    },
  },
});

/** One line of a row's fields while they are read: a bar across the row, as tall as a control. */
const FIELD_LINE = "col-span-full h-8 rounded-lg pointer-coarse:h-10";

type Slots = ReturnType<typeof recordRows>;

/** The keys of the rows as they stand, the next key to give, and the key of the row the add control just made. */
type Keys = { keys: readonly number[]; next: number; added: number | null };

/**
 * Hands the keys to the first control of the row it stands in, once, as the row the add control made mounts: moved in
 * an effect, as the code field's focus is (`./CodeField.tsx`), through React Aria's focus manager, which knows what a
 * Tab reaches. Once, because Next shows a kept page again by running its effects again, the keys elsewhere by then.
 */
function FirstControlFocus() {
  const manager = useFocusManager();
  const isDone = useRef(false);
  useEffect(() => {
    if (isDone.current) return;
    isDone.current = true;
    manager?.focusFirst({ tabbable: true });
  }, [manager]);
  return null;
}

function RecordRow<Row extends EditorRow>({
  slots,
  cells,
  row,
  box,
  label,
  errors,
  change,
  removal,
  takesFocus,
}: {
  slots: Slots;
  cells: RowCells<Row>;
  row: Row;
  /** The row's own path, `scorers.2`. */
  box: string;
  /** The label counting the row, such as „Tor 3“. */
  label: Copy;
  errors: Readonly<Record<string, Copy>> | undefined;
  change: (patch: Partial<Row>) => void;
  /** The remove control's name and its act; absent in a form closed read-only. */
  removal: { label: Copy; act: () => void } | undefined;
  takesFocus: boolean;
}) {
  const labelId = useId();
  const element = useRef<HTMLDivElement>(null);
  // A removed row hands the keys to the row after it, or before it, or to the list.
  useFocusHome(element);
  const control = (cell: RowCell<Row>) => {
    const field = `${box}.${cell.field}`;
    return cell.control({ row, name: field, label: cell.label, error: errors?.[field], change });
  };
  return (
    <div
      ref={element}
      data-kit-row
      role="group"
      aria-labelledby={labelId}
      className={slots.row()}>
      <div
        id={labelId}
        className={slots.label()}>
        {label}
      </div>
      <FocusScope>
        {takesFocus && <FirstControlFocus />}
        <div className={slots.lead()}>{control(cells.lead)}</div>
        <div className={slots.figure()}>{control(cells.figure)}</div>
        <div className={slots.second()}>
          <div className={slots.main()}>{control(cells.main)}</div>
          {cells.beside !== undefined && <div className={slots.beside()}>{control(cells.beside)}</div>}
        </div>
        {cells.below !== undefined && <div className={slots.below()}>{control(cells.below)}</div>}
        {removal !== undefined && (
          <div className={slots.remove()}>
            <Button
              icon="close"
              label={removal.label}
              aria-describedby={labelId}
              onPress={removal.act}
            />
          </div>
        )}
      </FocusScope>
    </div>
  );
}

/**
 * A list of records as rows of fields, such as a Spielbericht's goals: each row under the label counting it, its
 * fields on two or three lines on a phone and on one from desktop up, the remove control at its end, and the add
 * control in the foot under the list. It stands edge to edge in its box (`./Section.tsx`'s `list`), the hairline
 * between two rows reaching the box's edges. The value is the editor's (`./useEditor.ts :: EditorRow`): `rows` its
 * draft's list, `onChange` the whole list anew.
 *
 * A row's refusal stands on the row's own line, under its fields and always there, and the refused field takes the
 * kit's invalid look. A kit field named as its cell names it takes the form's served refusal by that name and keeps its
 * own check at the send; a choice posting no form value takes `error` as its `errorMessage`. A field in a row carries
 * no description, since the row's one line is the refusal's. The list's own refusal, such as too many rows, stands
 * under the add control.
 *
 * The add control appends `blank` and hands the keys to the new row's first control. A removed row hands them to the
 * row after it, else the row before it, else the list, as every row the kit lets leave does (`./RowActs.tsx`), so a
 * row's first control is one a press reaches, a button or a link. A form closed read-only draws neither control.
 */
export function RecordRows<Row extends EditorRow>({
  label,
  name,
  rows,
  onChange,
  blank,
  cells,
  rowLabel,
  add,
  remove,
  locked,
  errors,
}: {
  /** The list's name for a screen reader, the section's title naming it on the screen. */
  label: Copy;
  /** The list's box, `scorers`, which names each row's boxes: `scorers.2.minute`. */
  name: string;
  rows: ReadonlyArray<Row>;
  onChange: (rows: ReadonlyArray<Row>) => void;
  /** A new row as the add control makes it. */
  blank: Row;
  cells: RowCells<Row>;
  /** The label over a row by its number, from 1, such as „Tor 3“: it names the row and describes its remove control. */
  rowLabel: (number: number) => Copy;
  /** The add control's label, such as „Tor eintragen“. */
  add: Copy;
  /** The remove control's name, such as „Tor entfernen“. */
  remove: Copy;
  /**
   * Why the list takes no new row as the draft stands, such as a no-show's goals: the add control stays reachable and
   * says it, as every locked act does (`./Button.tsx`'s `locked`). The rows stand, each with its remove control.
   */
  locked?: Copy;
  /** The editor's served refusals by box (`./useEditor.ts`'s `fieldErrors`). */
  errors?: Readonly<Record<string, Copy>>;
}) {
  const slots = recordRows({ beside: cells.beside !== undefined });
  const isClosed = useDisabled(false);
  const lineId = useId();
  const [held, setHeld] = useState<Keys>(() => ({ keys: rows.map((_, index) => index), next: rows.length, added: null }));

  // A row keeps its key while the add and the remove control change the list. A list of another length was reset or
  // served anew: its rows keep their places' keys, and none of them was just made here.
  let current = held;
  if (held.keys.length !== rows.length) {
    const more = Array.from({ length: Math.max(0, rows.length - held.keys.length) }, (_, index) => held.next + index);
    current = { keys: [...held.keys.slice(0, rows.length), ...more], next: held.next + more.length, added: null };
    setHeld(current);
  }

  const listError = errors?.[name];

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={listError === undefined ? undefined : lineId}
      data-kit-focus="home"
      className={slots.root()}>
      {/* An empty list is its foot alone, which then stands first and draws no hairline over itself. */}
      {rows.length > 0 && (
        <div className={slots.grid()}>
          {rows.map((row, index) => (
            <RecordRow
              key={current.keys[index]}
              slots={slots}
              cells={cells}
              row={row}
              box={`${name}.${String(index)}`}
              label={rowLabel(index + 1)}
              errors={errors}
              change={(patch) => onChange(rows.map((other, at) => (at === index ? { ...other, ...patch } : other)))}
              removal={
                isClosed
                  ? undefined
                  : {
                      label: remove,
                      act: () => {
                        setHeld((state) => ({ ...state, keys: state.keys.filter((_, at) => at !== index) }));
                        onChange(rows.filter((_, at) => at !== index));
                      },
                    }
              }
              takesFocus={current.keys[index] === current.added}
            />
          ))}
        </div>
      )}
      {!isClosed && (
        <div className={slots.foot()}>
          <Button
            variant="secondary"
            leadingIcon="create"
            label={add}
            locked={locked}
            lockedEdge="start"
            onPress={() => {
              setHeld((state) => ({ keys: [...state.keys, state.next], next: state.next + 1, added: state.next }));
              onChange([...rows, blank]);
            }}
          />
          {/* Always there, so the list's refusal appearing moves nothing. */}
          <div
            id={lineId}
            data-kit-message
            className={slots.line()}>
            {listError}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The list while its record is read: `rows` rows, each its label's line over as many lines of fields as a row takes
 * on a phone, two, or three where it has a cell below, and over one from desktop up; then the foot's add control by
 * its label. Drawn from the rows' own recipe, so it stands as tall as the list will.
 * @awaitsPage the referee's Spielbericht page
 * @awaitsProduction the referee's Spielbericht page
 */
export function RecordRowsPlaceholder({ rows, lines, add }: { rows: number; lines: 2 | 3; add: Copy }) {
  const slots = recordRows({ beside: false });
  return (
    <div className={slots.root()}>
      {rows > 0 && (
        <div className={slots.grid()}>
          {Array.from({ length: rows }, (_, row) => (
            <div
              key={row}
              className={slots.row()}>
              <PlaceholderLine
                text={slots.label()}
                width="w-12"
              />
              {Array.from({ length: lines }, (_, line) => (
                <span
                  key={line}
                  className={placeholderBar(line === 0 ? FIELD_LINE : `${FIELD_LINE} lg:hidden`)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <div className={slots.foot()}>
        <span className={buttonPlaceholder()}>
          <Icon
            glyph="create"
            size={16}
          />
          {add}
        </span>
      </div>
    </div>
  );
}
