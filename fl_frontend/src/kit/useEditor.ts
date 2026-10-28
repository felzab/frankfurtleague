"use client";

import { useEffect, useState } from "react";

import { COPY } from "@/core/copy";

import { useHoldLeave } from "./LeaveGuard";
import { useFormAction } from "./useFormAction";

import type { Copy } from "@/core/copy";
import type { ActionAnswer } from "./useFormAction";

/** A value an editor's field holds: text, a figure, a choice, or nothing yet. */
export type EditorValue = string | number | boolean | null | ReadonlyArray<string>;

/**
 * A record as an editable read serves it: its id, the fingerprint of exactly what was served, and the
 * values the editor's fields start from.
 */
export type EditorRecord<Values extends Record<string, EditorValue>> = {
  id: string;
  fingerprint: string;
  values: Values;
};

/**
 * What a save sends: the record, the fingerprint the draft was made on, and only the fields that differ
 * from it. The server refuses the save as stale once the stored record no longer matches the fingerprint.
 */
export type EditorSave<Values extends Record<string, EditorValue>> = {
  id: string;
  fingerprint: string;
  changes: Partial<Values>;
};

/** The status line beside „Speichern“: its words and its tone, or nothing. */
export type EditorStatus = { tone: "changes" | "saved" | "error"; text: Copy } | null;

function sameValue(a: EditorValue | undefined, b: EditorValue | undefined) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index]);
  return Object.is(a, b);
}

/** The edits that still differ from the stored values: an edit typed back to the stored value is no change. */
function changesOf<Values extends Record<string, EditorValue>>(stored: Values, edits: Partial<Values>) {
  return Object.fromEntries(Object.entries(edits).filter(([key, value]) => !sameValue(value, stored[key]))) as Partial<Values>;
}

type Held<Values extends Record<string, EditorValue>> = {
  /** The record the edits belong to: another id starts a fresh draft. */
  id: string;
  /** The fingerprint the draft was made on, which a save sends. */
  base: string;
  edits: Partial<Values>;
  /** This editor's own save went through: the next fingerprint the page serves is the saved record's. */
  adopt: boolean;
  /** The last save: the record as the page served it when it was sent, and the changes it sent. */
  sent: { from: EditorRecord<Values>; changes: Partial<Values> } | null;
  /** Counts the edits, so a refusal is shown only until the person edits again. */
  version: number;
  sentVersion: number;
  /** The version the browser refused to send for its fields' own rules, before any request. */
  blockedVersion: number;
};

const fresh = <Values extends Record<string, EditorValue>>(record: EditorRecord<Values>): Held<Values> => ({
  id: record.id,
  base: record.fingerprint,
  edits: {},
  adopt: false,
  sent: null,
  version: 0,
  sentVersion: -1,
  blockedVersion: -1,
});

/**
 * The one way an editor holds its record: a draft made of the stored values and the person's edits, the
 * changes computed against the stored values, the fingerprint of the read the draft was made on, and the
 * save through the one form action. Keyed on the record's id, so a refreshed read never clears a draft and
 * another record always starts one fresh.
 *
 * When the page serves the record anew, the draft takes the new fingerprint only where nothing unsaved
 * rests on the old one, or where this editor's own save produced it; a draft made on a read someone else
 * has since changed keeps the old fingerprint, so its save is refused as stale rather than overwriting. A
 * save the write stores as what was already stored is served back under the same fingerprint, and the draft
 * then holds what the record holds.
 *
 * While changes are unsaved, the frame's way back asks before it drops them, and the browser asks before a
 * reload or a closed tab. A „Gespeichert“ shown is cleared once the page is left, the documented reset; an
 * unsaved draft stays with the page Next keeps.
 */
export function useEditor<Values extends Record<string, EditorValue>>(
  record: EditorRecord<Values>,
  save: (change: EditorSave<Values>) => Promise<ActionAnswer>,
) {
  const [held, setHeld] = useState<Held<Values>>(() => fresh(record));

  // A new record, or a new read of this one, is taken while rendering, React's pattern for state that
  // follows a prop, so no render ever shows a draft on the wrong record.
  let current = held;
  if (held.id !== record.id) {
    current = fresh(record);
  } else if (held.base !== record.fingerprint) {
    const pending = changesOf(record.values, held.edits);
    if (held.adopt || Object.keys(pending).length === 0) {
      current = { ...held, base: record.fingerprint, edits: pending, adopt: false };
    }
  } else if (held.adopt && held.sent !== null && record !== held.sent.from) {
    // Served anew after this editor's own save under the fingerprint it was sent from: the write stored a value
    // it reads as the one already stored, a trimmed note or a price without its leading zero. There is nothing
    // to adopt, so the flag goes, or the next read someone else changed would be taken as this save's while
    // edits rest on the old one. The edits the save sent, untouched since, are what the record now holds.
    const gesendet = held.sent.changes;
    const edits = Object.fromEntries(
      Object.entries(held.edits).filter(([key, value]) => !(key in gesendet && sameValue(value, gesendet[key]))),
    ) as Partial<Values>;
    current = { ...held, edits, adopt: false };
  }
  if (current !== held) setHeld(current);

  const changes = changesOf(record.values, current.edits);
  const count = Object.keys(changes).length;
  const draft = { ...record.values, ...current.edits };

  const form = useFormAction(
    async (sent: EditorSave<Values>) => {
      const answer = await save(sent);
      if (answer.ok) setHeld((state) => (state.id === sent.id ? { ...state, adopt: true } : state));
      return answer;
    },
    { resetOnLeave: true },
  );

  const discard = () => {
    setHeld((state) => ({ ...state, edits: {}, version: state.version + 1 }));
    form.reset();
  };

  useHoldLeave(count, discard);

  // The browser's own question before a reload or a closed tab; a navigation inside the site keeps the draft.
  useEffect(() => {
    if (count === 0) return undefined;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [count]);

  const { answer } = form;
  const refused = answer !== null && !answer.ok && current.version === current.sentVersion ? answer : null;
  let status: EditorStatus = null;
  if (current.blockedVersion === current.version) {
    status = { tone: "error", text: COPY.vorlage.felderPruefen };
  } else if (refused !== null) {
    status = {
      tone: "error",
      text: refused.reason ?? (refused.fieldErrors === undefined ? COPY.shared.fehler.unerwartet : COPY.vorlage.felderPruefen),
    };
  } else if (count > 0) {
    status = { tone: "changes", text: COPY.vorlage.aenderungenOffen(count) };
  } else if (answer?.ok === true) {
    // A save that moved more than this record says what else it moved, in place of the plain „Gespeichert“.
    status = { tone: "saved", text: answer.note ?? COPY.shared.gespeichert };
  }

  return {
    /** The values the fields show. */
    draft,
    /** Sets one field's value. */
    set: <Key extends keyof Values & string>(key: Key, value: Values[Key]) =>
      setHeld((state) => ({ ...state, edits: { ...state.edits, [key]: value }, version: state.version + 1 })),
    /** The fields that differ from the stored record, with their draft values. */
    changes,
    /** How many fields differ from the stored record. */
    count,
    status,
    /** The server's message for each field it refused, by the field's `name`. */
    fieldErrors: refused?.fieldErrors,
    /** Saves the whole record: its changed fields, on the fingerprint the draft was made on. */
    submit: () => {
      setHeld((state) => ({ ...state, sentVersion: state.version, adopt: false, sent: { from: record, changes } }));
      form.submit({ id: record.id, fingerprint: current.base, changes });
    },
    /** The browser kept the save back for a field's own rule: the status line points at the fields. */
    block: () => setHeld((state) => ({ ...state, blockedVersion: state.version })),
    isPending: form.isPending,
    /** Drops every unsaved change, as the discard dialog does. */
    discard,
  };
}

export type Editor<Values extends Record<string, EditorValue>> = ReturnType<typeof useEditor<Values>>;
