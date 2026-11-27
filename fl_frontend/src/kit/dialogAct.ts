import { COPY } from "@/core/copy/shared";

import type { ActionAnswer, DryRunAction } from "@/core/action";
import type { Copy, Verb, Words } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmQuestion, Tone } from "./ConfirmDialog";
import type { Fact } from "./Facts";

/**
 * What a dialog's act is, read by the dialog and by the list page drawing its trigger on the
 * server: kept apart from the client module, whose every export the server would receive as a reference it
 * cannot call.
 */

/**
 * The act ending the record a dialog edits, such as a squad row's „Austragen“: a part of its own after the dialog's
 * inputs and above its footer, between two hairlines, as a row of an editor's danger box stands, its name over its
 * consequence and its outlined button at the end, which asks before it acts.
 */
export type DialogDanger = {
  name: Copy;
  consequence: Copy;
  /**
   * The question its button opens, over the dialog; the button carries the question's verb and tone. The question
   * shows its act's refusal and stays open with it, as every question does, and a done act closes it and the dialog.
   * It asks no passkey touch: the question steps aside for the prompt, but the dialog's own modal under it would stand
   * and make the prompt inert.
   */
  confirm: Omit<ConfirmQuestion, "onConfirm" | "touch"> & {
    /** Does the act, answering whether it was done, which closes the dialog under the question. */
    onConfirm: () => Promise<ActionAnswer<unknown>>;
    touch?: never;
  };
};

/**
 * A verb an act answering in a toast may carry: one the catalogue words the act's toast for, as done
 * (`COPY.shared.toast.done`), since a done act closes its question or dialog, which leaves only the toast to say it.
 */
export type DoneVerb = keyof typeof COPY.shared.toast.done;

/** The verb, with its object where the verb alone does not say what it acts on („Spielort anlegen“). */
export type ActWords<V extends Verb> = { verb: V; object?: Copy };

/**
 * The server action doing a dialog's act, reading the form's fields by their `name`s, and the passkey touch it asks,
 * for an act on the touch's fixed list an administrator presses: the address the page was drawn for, which the form
 * posts as `holder` (`usePasskeyTouch`). A touched act's `run` is one whose lane declares its dry run, which the press
 * sends first with the dialog standing, each refusal on its field or its line; only a passing dry run steps the dialog
 * aside for the browser's prompt, and it stands again with its input for the act's answer.
 */
type DialogRun =
  { run: (formData: FormData) => Promise<ActionAnswer>; touch?: never } | { run: DryRunAction<FormData>; touch: { holder: string } };

/** A dialog's act, whatever opens it: its title, its verb, the action doing it and its inputs. */
export type DialogAct<T extends Tone = Tone> = DialogRun & {
  /** What the dialog is about: the act in the catalogue's words, or the record a small record's dialog edits, by its name. */
  title: Words;
  /** The act, whose verb names the dialog's button and words its toast once done. */
  act: ActWords<DoneVerb>;
  /** The act's inputs: the kit's fields. */
  children: ReactNode;
  /** The record the act is about, posted beside the inputs under these names, as a mailed form carries its key. */
  carry?: Readonly<Record<string, string>>;
  /** One line under the title naming what the inputs are about, such as the seat a person is written into. */
  lead?: Words;
  /** One sentence after the inputs: what the act does, as a question's `consequence` says. */
  consequence?: Copy;
  /** What that sentence rests on, under it, as a question's `facts`. */
  facts?: ReadonlyArray<Fact>;
  /** `danger` for an act taking a record out of something, as a danger box's question names its verb's tone. */
  tone?: T;
  /**
   * Why the act cannot run on the record as it stands, which the dialog's facts show: its button answers a press with
   * the reason, as every locked act of the kit does (`Button`'s `locked`), and the form sends nothing.
   */
  locked?: Copy;
  /**
   * The act ending the record the dialog's inputs edit, beside the dialog's own: a client page's, since its question's
   * act is a function, which cannot cross from the server.
   */
  danger?: DialogDanger;
};

/** The act's label, on the dialog's own button and on a trigger naming the same act. */
export function actLabel({ verb, object }: ActWords<Verb>): Copy {
  return object === undefined ? COPY.shared.verb[verb] : COPY.shared.withObject(object, verb);
}
