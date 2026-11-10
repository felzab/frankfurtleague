import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb, Words } from "@/core/copy";
import type { ReactNode } from "react";
import type { ConfirmDialogProps } from "./ConfirmDialog";
import type { Fact } from "./Facts";

/**
 * What a dialog's act is, read by the dialog (`Dialog.tsx`) and by the list page drawing its trigger on the
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
   */
  confirm: Omit<ConfirmDialogProps, "trigger" | "open">;
};

/** A dialog's act, whatever opens it: its title, its verb, the action doing it and its inputs. */
export type DialogAct = {
  /** What the dialog is about: the act in the catalogue's words, or the record a small record's dialog edits, by its name. */
  title: Words;
  /** The verb, with its object where the verb alone does not say what it acts on („Spielort anlegen“). */
  act: { verb: Verb; object?: Copy };
  /** The server action doing the act, reading the form's fields by their `name`s. */
  action: (formData: FormData) => Promise<ActionAnswer>;
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
  tone?: "primary" | "danger";
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
  /**
   * The passkey touch the act's button asks ahead of `action`, for an act on its fixed list a person holding a passkey
   * presses: the address the page was drawn for, which the form posts as `holder` (`usePasskeyTouch`). The dialog stands
   * with its inputs on a refused touch.
   */
  touch?: { holder: string };
};

/** The act's label, on the dialog's own button and on a trigger naming the same act. */
export function actLabel({ verb, object }: DialogAct["act"]): Copy {
  return object === undefined ? COPY.shared.verb[verb] : COPY.shared.withObject(object, verb);
}
