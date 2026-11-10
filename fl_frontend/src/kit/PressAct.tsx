"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "./Button";
import { toastAnswer } from "./Toast";
import { answering } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { IconName } from "./Icon";

/**
 * An act done at once on a press, with no question and no form: its button busy while it runs, its answer a toast,
 * `done` where it was done, the answer's own line where it partly happened, in the warn tone, or where it was refused,
 * and the page read again after a throw, as every act of the kit's answers one (`answering`). The act and what it
 * posts come as two, so a server page hands a server action and its record's id straight in. `locked` says why the act
 * cannot run on the record as it stands.
 */
export function PressAct<Payload, Value>({
  label,
  act,
  payload,
  done,
  locked,
  ...look
}: {
  label: Copy;
  act: (payload: Payload) => Promise<ActionAnswer<Value>>;
  payload: Payload;
  /** The toast's title once the act is done, from the catalogue's toast titles. */
  done: Copy;
  locked?: Copy;
} & ({ variant: "primary" | "secondary"; icon?: never } | { icon: IconName; variant?: never })) {
  const router = useRouter();
  const [isRunning, startRunning] = useTransition();
  const press = {
    label,
    locked,
    isBusy: isRunning,
    onPress: () =>
      startRunning(async () => {
        toastAnswer(await answering(act, router.refresh)(payload), done);
      }),
  };
  return look.icon === undefined ? (
    <Button
      variant={look.variant}
      {...press}
    />
  ) : (
    <Button
      icon={look.icon}
      {...press}
    />
  );
}
