"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { actLabel } from "./dialogAct";
import { FocusOnLeave } from "./FocusOnLeave";
import { toastAnswer } from "./Toast";
import { answering } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ActWords, DoneVerb } from "./dialogAct";

/**
 * An act done at once on a press, with no question and no form, for whatever control the press stands on: whether it
 * runs, and the press, which runs the act it is handed, bound to what it posts. Its answer is a toast, `done` where it
 * was done, the answer's own line where it partly happened, in the warn tone, or where it was refused, and a throw
 * answered as every act of the kit's answers one, the page read again only where the frontend answered (`answering`),
 * so a lost answer never reaches the error boundary.
 */
export function usePressAct(done: Copy) {
  const router = useRouter();
  const [isBusy, startRunning] = useTransition();
  const press = <Value,>(act: () => Promise<ActionAnswer<Value>>) =>
    startRunning(async () => {
      toastAnswer(await answering(act, router.refresh)(undefined), done);
    });
  return { isBusy, press };
}

/**
 * An act done at once on a press, drawn as its own primary button, busy while it runs (`usePressAct`): its verb names
 * the button and words the toast once it is done, as a dialog's act does. The act and what it posts come as two, so a
 * server page hands a server action and its record's id straight in.
 */
export function PressAct<Payload, Value>({
  act,
  run,
  payload,
}: {
  act: ActWords<DoneVerb>;
  run: (payload: Payload) => Promise<ActionAnswer<Value>>;
  payload: Payload;
}) {
  const { isBusy, press } = usePressAct(COPY.shared.toast.done[act.verb]);
  return (
    // The answer can drop the act's row, the focus with it (`FocusOnLeave`).
    <FocusOnLeave>
      <Button
        variant="primary"
        label={actLabel(act)}
        isBusy={isBusy}
        onPress={() => press(() => run(payload))}
      />
    </FocusOnLeave>
  );
}
