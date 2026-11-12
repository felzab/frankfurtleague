import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
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
   * It asks no passkey touch: the question closes before the prompt, but the dialog's own modal under it would stand
   * and make the prompt inert.
   */
  confirm: ConfirmQuestion & { touch?: never };
};

/**
 * A verb an act behind the passkey touch may carry: one the catalogue words the act's toast for, as done
 * (`COPY.shared.toast.done`), since the act's question or dialog has closed before it answers.
 */
export type TouchVerb = keyof typeof COPY.shared.toast.done;

/** The verb, with its object where the verb alone does not say what it acts on („Spielort anlegen“). */
type ActWords<V extends Verb> = { verb: V; object?: Copy };

/** A dialog's act, whatever opens it: its title, its verb, the action doing it and its inputs. */
export type DialogAct<T extends Tone = Tone> = {
  /** What the dialog is about: the act in the catalogue's words, or the record a small record's dialog edits, by its name. */
  title: Words;
  act: ActWords<Verb>;
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
} & (
  | { touch?: never }
  | {
      act: ActWords<TouchVerb>;
      /**
       * The passkey touch the act's button asks ahead of `action`, for an act on its fixed list a person holding a
       * passkey presses: the address the page was drawn for, which the form posts as `holder` (`usePasskeyTouch`). The
       * press closes the dialog for good before the browser asks, and the act answers in a toast, a refusal included,
       * the dialog's opening button standing again for a new try with the inputs typed anew.
       */
      touch: { holder: string };
    }
);

/** The act's label, on the dialog's own button and on a trigger naming the same act. */
export function actLabel({ verb, object }: ActWords<Verb>): Copy {
  return object === undefined ? COPY.shared.verb[verb] : COPY.shared.withObject(object, verb);
}
