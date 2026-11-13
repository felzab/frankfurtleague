"use client";

import { useContext, useId, useState } from "react";

import { Button } from "./Button";
import { smallCaps, stacked } from "./cardStyles";
import { messageLine, toggleBox, toggleField, toggleRow } from "./fieldStyles";
import { FormClosed } from "./formClosed";
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
 * A row's cells by their place. A narrow list's first line holds `lead`, a short choice heading the row, and `figure`,
 * a short field; its second `main`, the long field, and `beside`, a toggle at its end; `below` takes a third line, as
 * a card's colour does. From 42 rem of the list's box the first four stand on one line in this order, and `below`
 * keeps a line of its own under them.
 */
export type RowCells<Row extends EditorRow> = { lead: RowCell<Row>; figure: RowCell<Row>; main: RowCell<Row> } & (
  | { beside?: RowCell<Row>; below?: never; room?: never }
  | {
      below: RowCell<Row>;
      beside?: never;
      /**
       * The words of the box another list of the page holds beside its main field, as the goals' „Eigentor“ stands
       * beside their player: each row keeps that box's room empty, so the main fields of both lists end at one x.
       */
      room?: string;
    }
);

/*
 * The rows' whole look, in the one place a ruling changes it: the grid, the hairline between rows, the row's label and
 * every gap, each 4, 8 or 16 px.
 */
const recordRows = tv({
  slots: {
    // Edge to edge in its box, which holds it unpadded (`Section`'s `list`): the rows, then the foot. The container whose
    // width picks the rows' form, not the screen's, since the rail resizes the box under one viewport.
    root: "@container grid w-full min-w-0",
    // The columns every row shares, so a field stands at one x in every row. Below 42 rem the first line: the lead, the
    // figure, and the remove control at the row's end. From 42 rem one line: the lead and the figure at their own
    // widths, the main field taking the room that is left, since a row spans its box, up to its own standard width,
    // then the cell beside it at its own width and the remove control.
    grid: "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 text-sm @2xl:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] @2xl:gap-x-3 pointer-coarse:text-base",
    // A row brings the box's 16-px insets itself, so the hairline over it reaches the box's edges. Its label and its
    // lines stand 8 px apart, 16 px inside the hairlines over and under it. A field's message stands under that field
    // in its own cell, as under any field, and only while it has words, so the row grows by it as a refusal lands; the
    // cells hang from their tops, so the controls of a row stay on one line while one of them says something.
    row: `col-span-full grid grid-cols-subgrid items-start gap-y-2 p-4 ${stacked()}`,
    // The label counting the row, „Tor 1“, on the kit's label rung, the same at every width.
    label: smallCaps({ class: "col-span-full row-start-1" }),
    lead: "col-start-1 row-start-2",
    figure: "col-start-2 row-start-2",
    // A narrow list's second line, the main field and what stands beside it; from 42 rem its two cells are the row's own.
    second: "col-span-full row-start-3 grid items-start gap-x-2 @2xl:contents",
    main: "@2xl:col-start-3 @2xl:row-start-2",
    beside: "@2xl:col-start-4 @2xl:row-start-2",
    // A line of its own at every width, under the row's first line from 42 rem, so the main field keeps the room a name
    // needs beside the lead and the figure, which a card's three colours would leave it too little of.
    below: "col-span-full row-start-4 @2xl:col-span-4 @2xl:col-start-1 @2xl:row-start-3",
    // The cross ends with the fields' edge: its button, as wide as a control is tall, reaches past the edge by the
    // room it keeps around its 16-px glyph, 8 px with a mouse and 12 px on a touch screen.
    remove: "col-start-3 row-start-2 -me-2 justify-self-end @2xl:col-start-5 pointer-coarse:-me-3",
    // The add control in the box's padding, under the hairline that parts it from the last row, and the list's own
    // refusal 6 px under it while there is one, as a field's message stands under its field.
    foot: `grid justify-items-start gap-1.5 p-4 ${stacked()}`,
    line: messageLine({ tone: "error" }),
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

/** The keys of the rows as they stand, and the next key to give. */
type Keys = { keys: readonly number[]; next: number };

function RecordRow<Row extends EditorRow>({
  slots,
  cells,
  row,
  box,
  label,
  errors,
  change,
  removal,
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
}) {
  const labelId = useId();
  const control = (cell: RowCell<Row>) => {
    const field = `${box}.${cell.field}`;
    return cell.control({ row, name: field, label: cell.label, error: errors?.[field], change });
  };
  return (
    <div
      data-kit-row
      role="group"
      aria-labelledby={labelId}
      className={slots.row()}>
      <div
        id={labelId}
        className={slots.label()}>
        {label}
      </div>
      <div className={slots.lead()}>{control(cells.lead)}</div>
      <div className={slots.figure()}>{control(cells.figure)}</div>
      <div className={slots.second()}>
        <div className={slots.main()}>{control(cells.main)}</div>
        {cells.beside !== undefined && <div className={slots.beside()}>{control(cells.beside)}</div>}
        {cells.room !== undefined && (
          // The other list's box, drawn from the box's own recipes, unseen, unread and unreached: it holds the room the
          // box takes.
          <div
            aria-hidden
            inert
            className={slots.beside({ class: "invisible" })}>
            <div className={toggleField()}>
              <span className={toggleRow({ in: "field" })}>
                <span className={toggleBox({ shape: "square" })} />
                <span>{cells.room}</span>
              </span>
            </div>
          </div>
        )}
      </div>
      {cells.below !== undefined && <div className={slots.below()}>{control(cells.below)}</div>}
      {removal !== undefined && (
        <div className={slots.remove()}>
          <Button
            icon="close"
            label={removal.label}
            onPress={removal.act}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A list of records as rows of fields, such as a Spielbericht's goals: each row under the label counting it, its
 * fields on two or three lines in a list narrower than 42 rem and on one, or two with a cell below, from it, the remove
 * control at the end of its first line, and the add
 * control in the foot under the list. It stands edge to edge in its box (`Section`'s `list`), the hairline
 * between two rows reaching the box's edges. The value is the editor's (`EditorRow`): `rows` its
 * draft's list, `onChange` the whole list anew.
 *
 * Each refused field's refusal stands under it, however many of a row's fields are refused, and the refused field takes
 * the kit's invalid look. A kit field named as its cell names it takes the form's served refusal by that name and keeps
 * its own check at the send; a choice posting no form value takes `error` as its `errorMessage`. A field in a row
 * carries no description, so the line under a field is its refusal's alone.
 * The list's own refusal, such as too many rows, stands under the add control.
 *
 * The add control appends `blank`. A form closed read-only draws neither control.
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
  /** The label over a row by its number, from 1, such as „Tor 3“, which names the row. */
  rowLabel: (number: number) => Copy;
  /** The add control's label, such as „Tor eintragen“. */
  add: Copy;
  /** The remove control's name, such as „Tor entfernen“. */
  remove: Copy;
  /**
   * Why the list takes no new row as the draft stands, such as a no-show's goals: the add control stays reachable and
   * says it, as every locked act does (`Button`'s `locked`). The rows stand, each with its remove control.
   */
  locked?: Copy;
  /** The editor's served refusals by box (`useEditor`'s `fieldErrors`). */
  errors?: Readonly<Record<string, Copy>>;
}) {
  const slots = recordRows({ beside: cells.beside !== undefined || cells.room !== undefined });
  const isClosed = useContext(FormClosed);
  const lineId = useId();
  const [held, setHeld] = useState<Keys>(() => ({ keys: rows.map((_, index) => index), next: rows.length }));

  // A row keeps its key while the add and the remove control change the list. A list of another length was reset or
  // served anew: its rows keep their places' keys.
  let current = held;
  if (held.keys.length !== rows.length) {
    const more = Array.from({ length: Math.max(0, rows.length - held.keys.length) }, (_, index) => held.next + index);
    current = { keys: [...held.keys.slice(0, rows.length), ...more], next: held.next + more.length };
    setHeld(current);
  }

  const listError = errors?.[name];

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={listError === undefined ? undefined : lineId}
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
              setHeld((state) => ({ keys: [...state.keys, state.next], next: state.next + 1 }));
              onChange([...rows, blank]);
            }}
          />
          {listError !== undefined && (
            <div
              id={lineId}
              data-kit-message
              className={slots.line()}>
              {listError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
