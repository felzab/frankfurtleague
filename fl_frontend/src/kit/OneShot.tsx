"use client";

import { createContext, useContext, useRef, useState } from "react";

import { Form } from "react-aria-components/Form";

import { Button } from "./Button";
import { ClassicPage } from "./ClassicPage";
import { StatusLine } from "./FieldParts";
import { StatusPage } from "./StatusPage";
import { statusOf, useFormAction } from "./useFormAction";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { StatusCardProps } from "./StatusPage";
import type { FormStatus } from "./useFormAction";

/** The end a one-shot form reaches: the status page that replaces it, as the server words it. */
export type EndState = StatusCardProps;

/** Which of the form's acts was pressed: the main one, or the quieter one beneath it. */
export type Act = "primary" | "secondary";

/** The field the pressed act posts under, beside the form's own, which the page's action reads by this name. */
const ACT_FIELD = "act";

/**
 * The server action a one-shot form posts to, built by `fl_frontend/src/core/action.ts :: action`: the fields by their
 * `name`s, the values the page carries, and the act pressed under `ACT_FIELD`.
 */
export type OneShotAction = (formData: FormData) => Promise<ActionAnswer<EndState>>;

/** Where a one-shot form hands the end its action reached, to the boundary holding it above the page's state. */
const AnsweredEnd = createContext<((end: EndState) => void) | null>(null);

/**
 * The one-shot's end, held above the mailed page's state, whose place a done answer takes for good. A done action
 * renders the page again with the cache tag its write cleared (`fl_frontend/src/core/action.ts :: body`), and the
 * link read again is in another state, the opened-again one, which takes the form's place in the same response.
 * React keeps a component's state only while its type stays at its place in the tree
 * (https://react.dev/learn/preserving-and-resetting-state), so the answer is lifted to this boundary, whose place the
 * re-render never changes, rather than kept in the form the re-render replaces.
 */
export function OneShotEnd({ children }: { children: ReactNode }) {
  const [end, setEnd] = useState<EndState | null>(null);
  if (end !== null) {
    return (
      <StatusPage
        frame="classic"
        {...end}
      />
    );
  }
  return <AnsweredEnd value={setEnd}>{children}</AnsweredEnd>;
}

/**
 * The one-shot submit: a page in the classic frame's form column whose form is sent once and whose outcome
 * replaces it. Done, the server's end state takes the page's place as the status template; refused, the
 * form stays with its input, each field's message under its field and the reason in the line under the
 * acts. The main act stands full width; a second, quieter act beneath it sends without asking the fields,
 * as an objection needs none of them. The end stands in `OneShotEnd`, which the form stands inside, and outlives
 * a visit elsewhere and the page's own re-render: what was done stays done.
 */
export function OneShotForm({
  head,
  action,
  acts,
  carry = {},
  touch = false,
  children,
}: {
  /** What stands above the form: the page's title and what the person answers. */
  head: ReactElement;
  action: OneShotAction;
  acts: { primary: Copy; secondary?: Copy };
  /** What the form posts beside its fields, unseen: the token the page's link carries. */
  carry?: Readonly<Record<string, string>>;
  /** The main act asks the passkey touch first, for a person holding a passkey (`usePasskeyTouch`). */
  touch?: boolean;
  /** The form's fields, the kit's, each with its `name`. */
  children?: ReactNode;
}) {
  const answered = useContext(AnsweredEnd);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    async (formData: FormData) => {
      const reached = await action(formData);
      // Handed up before the answer settles here: the same response may already have replaced this form.
      if (reached.ok) answered?.(reached.value);
      return reached;
    },
    { resetOnLeave: false },
  );
  const { run, refusal, isTouching } = usePasskeyTouch(touch, carry.holder);
  const form = useRef<HTMLFormElement>(null);
  const [pressed, setPressed] = useState<Act>("primary");

  // The end stands in `OneShotEnd`, in this form's place.
  if (answer?.ok === true) return null;

  const refused = answer !== null && !answer.ok ? answer : null;
  const status: FormStatus = refusal !== null ? { tone: "error", text: refusal } : statusOf(refused, isBlocked, isPending);
  const isBusy = isPending || isTouching;

  const send = (element: HTMLFormElement, act: Act) => {
    setPressed(act);
    // Read before the prompt, which the browser may hold for as long as the person takes.
    const formData = new FormData(element);
    for (const [name, value] of Object.entries(carry)) formData.set(name, value);
    formData.set(ACT_FIELD, act);
    // The quieter act posts without the touch: an objection hands nothing over.
    if (act === "primary") void run(() => submit(formData));
    else submit(formData);
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
          if (!isBusy) send(event.currentTarget, "primary");
        }}
        className="grid gap-6">
        {children !== undefined && <div className="grid justify-items-start gap-4">{children}</div>}
        {/* Full width on a phone; from `lg` each act as wide as its label, centred in the column, as a status card
            sets its way on, with the status line centred under them. */}
        <div className="grid gap-3 lg:justify-items-center lg:text-center">
          <Button
            variant="primary"
            type="submit"
            label={acts.primary}
            isBusy={isBusy && pressed === "primary"}
          />
          {acts.secondary !== undefined && (
            <Button
              variant="quiet"
              label={acts.secondary}
              isBusy={isBusy && pressed === "secondary"}
              onPress={() => {
                if (form.current !== null && !isBusy) send(form.current, "secondary");
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
