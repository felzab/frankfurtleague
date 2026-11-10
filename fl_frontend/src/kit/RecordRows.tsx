"use client";

import { useEffect, useId, useRef, useState } from "react";

import { FocusScope, useFocusManager } from "react-aria/FocusScope";

import { Button } from "./Button";
import { smallCaps, stacked } from "./cardStyles";
import { RequiredMark } from "./FieldParts";
import { messageLine } from "./fieldStyles";
import { useDisabled } from "./formClosed";
import { useFocusHome } from "./RowActs";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { EditorRow } from "./useEditor";

/** What a row's cell hands its control. */
export type RowControl<Row extends EditorRow> = {
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

/** One cell of every row: the field it edits, its column's head from desktop up, and its control, a kit field. */
export type RowCell<Row extends EditorRow> = {
  field: keyof Row & string;
  label: Copy;
  /** The asterisk after the column's head; the control takes its own `isRequired`. */
  isRequired?: boolean;
  control: (cell: RowControl<Row>) => ReactNode;
};

/**
 * A row's cells by their place. A phone's first line holds `lead`, a short choice heading the row, and `figure`, a
 * short field; its second `main`, the long field, and `beside`, a toggle at its end; `below` takes a third line, its
 * `mark` standing before its control, such as a card's colour beside the choice of it. From desktop up they stand on
 * one line in this order, `beside` or `below` last.
 */
export type RowCells<Row extends EditorRow> = { lead: RowCell<Row>; figure: RowCell<Row>; main: RowCell<Row> } & (
  { beside?: RowCell<Row>; below?: never } | { below: RowCell<Row> & { mark?: (row: Row) => ReactNode }; beside?: never }
);

/**
 * A later cell's message goes while an earlier one says something: a row has one line, and its first refused field
 * speaks on it, as a box shows the first refusal it meets.
 */
const FIRST_MESSAGE = "[&>:has([data-kit-message]:not(:empty))~*_[data-kit-message]]:hidden";

/*
 * The rows' whole look, in the one place a ruling changes it: the grid, the hairline between rows and every gap.
 */
const recordRows = tv({
  slots: {
    // The rows, then the add control over the list's own line: 8 px apart, as a box's fields are.
    root: "grid w-full min-w-0 gap-2",
    // The columns every row shares, so a field stands at one x in every row. A phone's first line: the lead, the
    // figure, and the remove control at the row's end. From desktop up one line: the lead, the figure, the main field
    // up to a form field's cap, the trailing cell taking the room that is left, the remove control. The cap is
    // counted in the field's own letters, so the grid is set in the field's text.
    grid: "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 text-sm lg:grid-cols-[auto_auto_minmax(0,var(--container-field))_1fr_auto] lg:gap-x-3 pointer-coarse:text-base",
    // A column's head over its fields from desktop up, where a row is one line; a phone's two lines have no columns
    // to head, and each control shows what it holds.
    head: "col-span-full hidden grid-cols-subgrid pb-1 lg:grid",
    headCell: smallCaps(),
    // The rows are the grid's own items, apart from the head, so the first row is the first of its kind.
    rows: "contents",
    // A row's lines 8 px apart, the row's message line the last of them: 16 px tall, as a field's own line is, and
    // always there, in the 24 px under the controls, which the 24 px above them equal, so the rows keep one rhythm and
    // a message appearing moves nothing. Each field's own line is laid there, out of the row's flow, so a field keeps
    // its own check and its own description for a screen reader.
    row: `relative col-span-full grid grid-cols-subgrid items-center gap-y-2 py-6 first:pt-0 ${stacked()} [&_[data-kit-message]]:absolute [&_[data-kit-message]]:inset-x-0 [&_[data-kit-message]]:bottom-0 ${FIRST_MESSAGE}`,
    lead: "col-start-1 row-start-1",
    figure: "col-start-2 row-start-1",
    // A phone's second line, the main field and what stands beside it; from desktop up its two cells are the row's own.
    second: `col-span-full row-start-2 grid items-center gap-x-2 lg:contents ${FIRST_MESSAGE}`,
    main: "lg:col-start-3 lg:row-start-1",
    beside: "lg:col-start-4 lg:row-start-1",
    // The mark's slot, then the control, 8 px apart.
    below: "col-span-full row-start-3 flex items-center gap-2 lg:col-span-1 lg:col-start-4 lg:row-start-1",
    remove: "col-start-3 row-start-1 justify-self-end lg:col-start-5",
    // The add control over the list's own message line, as a field's frame stands over its line.
    foot: "flex flex-col items-start gap-1",
    line: messageLine({ tone: "error", class: "self-stretch" }),
  },
  variants: {
    // The main field shares its line with what stands beside it, or takes the line whole.
    beside: {
      true: { second: "grid-cols-[minmax(0,1fr)_auto]" },
      false: { second: "grid-cols-[minmax(0,1fr)]" },
    },
  },
});

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
  name,
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
  /** The row's name for a screen reader, such as „Tor 3“. */
  name: Copy;
  errors: Readonly<Record<string, Copy>> | undefined;
  change: (patch: Partial<Row>) => void;
  /** The remove control's label and its act; absent in a form closed read-only. */
  removal: { label: Copy; act: () => void } | undefined;
  takesFocus: boolean;
}) {
  const nameId = useId();
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
      aria-labelledby={nameId}
      className={slots.row()}>
      <span
        id={nameId}
        hidden>
        {name}
      </span>
      <FocusScope>
        {takesFocus && <FirstControlFocus />}
        <div className={slots.lead()}>{control(cells.lead)}</div>
        <div className={slots.figure()}>{control(cells.figure)}</div>
        <div className={slots.second()}>
          <div className={slots.main()}>{control(cells.main)}</div>
          {cells.beside !== undefined && <div className={slots.beside()}>{control(cells.beside)}</div>}
        </div>
        {cells.below !== undefined && (
          <div className={slots.below()}>
            {cells.below.mark?.(row)}
            {control(cells.below)}
          </div>
        )}
        {removal !== undefined && (
          <div className={slots.remove()}>
            <Button
              icon="close"
              label={removal.label}
              aria-describedby={nameId}
              onPress={removal.act}
            />
          </div>
        )}
      </FocusScope>
    </div>
  );
}

/**
 * A list of records as rows of fields, such as a Spielbericht's goals: each row its fields on two lines on a phone and
 * on one from desktop up, the remove control at its end, and the add control under the list. The value is the editor's
 * (`./useEditor.ts :: EditorRow`): `rows` its draft's list, `onChange` the whole list anew.
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
  rowName,
  add,
  remove,
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
  /** A row's name for a screen reader by its place, such as „Tor 3“, which also describes its remove control. */
  rowName: (index: number) => Copy;
  /** The add control's label, such as „Tor eintragen“. */
  add: Copy;
  /** The remove control's name, such as „Tor entfernen“. */
  remove: Copy;
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
  const head = [cells.lead, cells.figure, cells.main, cells.beside ?? cells.below].filter((cell) => cell !== undefined);

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={listError === undefined ? undefined : lineId}
      data-kit-focus="home"
      className={slots.root()}>
      <div className={slots.grid()}>
        {rows.length > 0 && (
          <div className={slots.head()}>
            {head.map((cell) => (
              <span
                key={cell.field}
                className={slots.headCell()}>
                {cell.label}
                <RequiredMark isRequired={cell.isRequired === true} />
              </span>
            ))}
          </div>
        )}
        <div className={slots.rows()}>
          {rows.map((row, index) => (
            <RecordRow
              key={current.keys[index]}
              slots={slots}
              cells={cells}
              row={row}
              box={`${name}.${String(index)}`}
              name={rowName(index)}
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
      </div>
      <div className={slots.foot()}>
        {!isClosed && (
          <Button
            variant="secondary"
            leadingIcon="create"
            label={add}
            onPress={() => {
              setHeld((state) => ({ keys: [...state.keys, state.next], next: state.next + 1, added: state.next }));
              onChange([...rows, blank]);
            }}
          />
        )}
        {/* Always there, so the list's refusal appearing moves nothing. */}
        <div
          id={lineId}
          data-kit-message
          className={slots.line()}>
          {listError}
        </div>
      </div>
    </div>
  );
}
