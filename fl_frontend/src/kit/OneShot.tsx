"use client";

import { useRef, useState } from "react";

import { Form } from "react-aria-components/Form";

import { Button } from "./Button";
import { ClassicPage } from "./ClassicPage";
import { StatusLine } from "./FieldParts";
import { StatusPage } from "./StatusPage";
import { statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { StatusCardProps } from "./StatusPage";

/** The end a one-shot form reaches: the status page that replaces it, as the server words it. */
export type EndState = StatusCardProps & { title: Copy };

/** Which of the form's acts was pressed: the main one, or the quieter one beneath it. */
export type Act = "primary" | "secondary";

/** The server action a one-shot form posts to: the fields by their `name`s, and the act pressed. */
export type OneShotAction = (formData: FormData, act: Act) => Promise<ActionAnswer<EndState>>;

/**
 * The one-shot submit: a page in the classic frame's form column whose form is sent once and whose outcome
 * replaces it. Done, the server's end state takes the page's place as the status template; refused, the
 * form stays with its input, each field's message under its field and the reason in the line under the
 * acts. The main act stands full width; a second, quieter act beneath it sends without asking the fields,
 * as an objection needs none of them. The answer outlives a visit elsewhere: what was done stays done.
 */
export function OneShotForm({
  head,
  action,
  acts,
  children,
}: {
  /** What stands above the form: the page's title and what the person answers. */
  head: ReactNode;
  action: OneShotAction;
  acts: { primary: Copy; secondary?: Copy };
  /** The form's fields, the kit's, each with its `name`. */
  children?: ReactNode;
}) {
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    ({ formData, act }: { formData: FormData; act: Act }) => action(formData, act),
    { resetOnLeave: false },
  );
  const form = useRef<HTMLFormElement>(null);
  const [pressed, setPressed] = useState<Act>("primary");

  if (answer?.ok === true) {
    return (
      <StatusPage
        frame="classic"
        {...answer.value}
      />
    );
  }

  const refused = answer !== null && !answer.ok ? answer : null;
  const status = statusOf(refused, isBlocked, isPending);

  const send = (element: HTMLFormElement, act: Act) => {
    setPressed(act);
    submit({ formData: new FormData(element), act });
  };

  return (
    <ClassicPage width="form">
      {head}
      <Form
        ref={form}
        validationErrors={refused?.fieldErrors}
        onInvalid={block}
        onSubmit={(event) => {
          event.preventDefault();
          send(event.currentTarget, "primary");
        }}
        className="grid gap-6">
        {children !== undefined && <div className="grid justify-items-start gap-4">{children}</div>}
        <div className="grid gap-3">
          <Button
            variant="primary"
            type="submit"
            label={acts.primary}
            isBusy={isPending && pressed === "primary"}
          />
          {acts.secondary !== undefined && (
            <Button
              variant="quiet"
              label={acts.secondary}
              isBusy={isPending && pressed === "secondary"}
              onPress={() => {
                if (form.current !== null) send(form.current, "secondary");
              }}
            />
          )}
          <StatusLine
            status={status}
            placement="column"
          />
        </div>
      </Form>
    </ClassicPage>
  );
}
