"use client";

import { startTransition, useEffect, useState } from "react";

import { COPY } from "@/core/copy";

import { useHoldLeave } from "./LeaveGuard";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer, FormStatus } from "./useFormAction";

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
  /**
   * This editor's own save went through and the page has not yet served what it stored: the fingerprint the
   * save was sent on, the one it answered as stored, and the changes it sent.
   */
  settling: { from: string; stored: string; changes: Partial<Values> } | null;
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
  settling: null,
  version: 0,
  sentVersion: -1,
  blockedVersion: -1,
});

/** The edits less those a save sent that nobody has touched since: the record holds them now, in its own form. */
function lessSent<Values extends Record<string, EditorValue>>(edits: Partial<Values>, sent: Partial<Values>) {
  return Object.fromEntries(Object.entries(edits).filter(([key, value]) => !(key in sent && sameValue(value, sent[key])))) as Partial<Values>;
}

/**
 * The one way an editor holds its record: a draft made of the stored values and the person's edits, the
 * changes computed against the stored values, the fingerprint of the read the draft was made on, and the
 * save through the one form action. Keyed on the record's id, so a refreshed read never clears a draft and
 * another record always starts one fresh.
 *
 * A save answers the fingerprint of the record it stored, which the draft takes at once. The page's fresh
 * serving is told apart by that fingerprint alone, never by when it arrives beside the answer: once it is
 * served, the changes the save sent, untouched since, are what the record holds, a value the write stored in
 * its own form (a trimmed note, a price without its leading zero) included. Any other new serving the draft
 * takes only where nothing unsaved rests on the read before it; a draft made on a read someone else has since
 * changed keeps its fingerprint, so its save is refused as stale rather than overwriting.
 *
 * While changes are unsaved, the frame's way back asks before it drops them, and the browser asks before a
 * reload or a closed tab. A „Gespeichert“ shown is cleared once the page is left, the documented reset; an
 * unsaved draft stays with the page Next keeps.
 */
export function useEditor<Values extends Record<string, EditorValue>>(
  record: EditorRecord<Values>,
  save: (change: EditorSave<Values>) => Promise<ActionAnswer<string>>,
) {
  const [held, setHeld] = useState<Held<Values>>(() => fresh(record));

  // A new record, or a new read of this one, is taken while rendering, React's pattern for state that
  // follows a prop, so no render ever shows a draft on the wrong record.
  let current = held;
  const { settling } = held;
  if (held.id !== record.id) {
    current = fresh(record);
  } else if (settling !== null && record.fingerprint === settling.stored) {
    current = { ...held, base: record.fingerprint, edits: lessSent(held.edits, settling.changes), settling: null };
  } else if (settling !== null && record.fingerprint === settling.from) {
    // Still the read the save was sent on: the page's fresh serving is on its way.
  } else if (settling !== null || held.base !== record.fingerprint) {
    // A serving newer than this editor's read, or than its own save: someone else wrote.
    const pending = changesOf(record.values, held.edits);
    // Under unsaved edits the draft keeps its fingerprint, set only where it changes, or each render would set it again.
    if (Object.keys(pending).length === 0) current = { ...held, base: record.fingerprint, edits: pending, settling: null };
    else if (settling !== null) current = { ...held, settling: null };
  }
  if (current !== held) setHeld(current);

  const changes = changesOf(record.values, current.edits);
  const count = Object.keys(changes).length;
  const draft = { ...record.values, ...current.edits };

  const form = useFormAction(
    async (sent: EditorSave<Values>): Promise<ActionAnswer> => {
      const answer = await save(sent);
      if (!answer.ok) return answer;
      const settled = { from: sent.fingerprint, stored: answer.value, changes: sent.changes };
      // A form's action runs in a transition, and an update after its `await` commits outside it.
      startTransition(() => setHeld((state) => (state.id === sent.id ? { ...state, base: answer.value, settling: settled } : state)));
      return { ok: true, value: undefined, note: answer.note };
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
  // A refusal stands only over the draft it was sent with; the count of unsaved fields stands over a done save.
  const answered = statusOf(answer?.ok === true ? answer : refused, current.blockedVersion === current.version, form.isPending);
  const status: FormStatus =
    answered?.tone !== "error" && count > 0 ? { tone: "changes", text: COPY.vorlage.aenderungenOffen(count) } : answered;

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
      setHeld((state) => ({ ...state, sentVersion: state.version }));
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
