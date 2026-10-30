import { COPY } from "@/core/copy";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * What a dialog's act is, read by the dialog (`Dialog.tsx`) and by the list page drawing its trigger on the
 * server: kept apart from the client module, whose every export the server would receive as a reference it
 * cannot call.
 */

/** A dialog's act, whatever opens it: its title, its verb, the action doing it and its inputs. */
export type DialogAct = {
  title: Copy;
  /** The verb, with its object where the verb alone does not say what it acts on („Spielort anlegen“). */
  act: { verb: Verb; object?: Copy };
  /** The server action doing the act, reading the form's fields by their `name`s. */
  action: (formData: FormData) => Promise<ActionAnswer>;
  /** The act's inputs: the kit's fields. */
  children: ReactNode;
};

/** The act's label, on the dialog's own button and on a trigger naming the same act. */
export function actLabel({ verb, object }: DialogAct["act"]): Copy {
  return object === undefined ? COPY.shared.verb[verb] : COPY.shared.mitObjekt(object, verb);
}
