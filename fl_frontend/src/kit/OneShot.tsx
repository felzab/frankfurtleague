"use client";

import { createContext, useContext, useRef, useState } from "react";

import { TURNSTILE_FIELD } from "@/core/turnstileToken";

import { Button } from "./Button";
import { ClassicPage } from "./ClassicPage";
import { StatusLine } from "./FieldParts";
import { FieldStack } from "./FieldStack";
import { boxStack } from "./fieldStyles";
import { HeldForm } from "./HeldForm";
import { RowActs } from "./RowActs";
import { StatusPage } from "./StatusPage";
import { useBotCheck } from "./useBotCheck";
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
 * a visit elsewhere and the page's own re-render: what was done stays done. A form anybody may send carries the bot
 * check above its acts, Cloudflare's widget showing only when Cloudflare asks, as wide as the column.
 */
export function OneShotForm({
  head,
  action,
  acts,
  carry = {},
  touch = false,
  botCheck,
  replayField,
  boxes = false,
  children,
}: {
  /** What stands above the form: the page's title and what the person answers. */
  head: ReactElement;
  action: OneShotAction;
  acts: { primary: Copy; secondary?: Copy };
  /** What the form posts beside its fields, unseen: the token the page's link carries. */
  carry?: Readonly<Record<string, string>>;
  /**
   * The main act's press asks the passkey touch ahead of `action`, for a person holding a passkey (`usePasskeyTouch`).
   * Such a form is a signed-in person's and takes no bot check, whose wait would lose the press the prompt needs.
   */
  touch?: boolean;
  /** The bot check's public key, on a form whose action declares the check (`fl_frontend/src/core/action.ts`). */
  botCheck?: { siteKey: string };
  /**
   * The field a replay key posts under, where a press whose answer was lost may have landed: a press posting what the
   * last one posted carries its key, so a retry finds the first press rather than repeating it, and a press after any
   * field changed carries a new one, since a key never stands for two different requests.
   */
  replayField?: string;
  /** The form's fields stand in `Section` boxes, which fill the column 24 px apart, as an editor's do. */
  boxes?: boolean;
  /** The form's fields, the kit's, each with its `name`. */
  children?: ReactNode;
}) {
  const answered = useContext(AnsweredEnd);
  const touched = usePasskeyTouch(touch, carry.holder);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    async (formData: FormData) => {
      // The quieter act posts without the touch: an objection hands nothing over.
      const reached = await (formData.get(ACT_FIELD) === "primary" ? touched(action) : action)(formData);
      // Handed up before the answer settles here: the same response may already have replaced this form.
      if (reached.ok) answered?.(reached.value);
      return reached;
    },
    { resetOnLeave: false },
  );
  const check = useBotCheck({ siteKey: botCheck?.siteKey ?? null, size: "flexible" });
  // What the last press posted and the key it carried, read again by every press however often the page reads again.
  const lastSent = useRef<{ posted: string; key: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [pressed, setPressed] = useState<Act>("primary");
  const [isChecking, setChecking] = useState(false);
  // The check's own refusal: the action never ran, so no answer of its says it.
  const [checkRefusal, setCheckRefusal] = useState<Copy | null>(null);

  // The end stands in `OneShotEnd`, in this form's place.
  if (answer?.ok === true) return null;

  const refused = answer !== null && !answer.ok ? answer : null;
  const status: FormStatus = checkRefusal !== null ? { tone: "error", text: checkRefusal } : statusOf(refused, isBlocked, isPending);
  const isBusy = isPending || isChecking;

  /** The token Cloudflare minted joins the form's data, or the press ends on the check's own sentence. */
  const checked = async (formData: FormData) => {
    setCheckRefusal(null);
    setChecking(true);
    const request = await check.takeToken();
    setChecking(false);
    if ("sentence" in request) {
      setCheckRefusal(request.sentence);
      return;
    }
    formData.set(TURNSTILE_FIELD, request.token);
    submit(formData);
  };

  /**
   * The key for what this press posts: the last press's where both post the same, a new one where any field changed. The
   * posted data is compared, never a change event, since a select's choice reaches the form as no event of its own.
   */
  const replayKeyFor = (formData: FormData) => {
    const posted = JSON.stringify([...formData]);
    if (lastSent.current?.posted !== posted) lastSent.current = { posted, key: crypto.randomUUID() };
    return lastSent.current.key;
  };

  const send = (formData: FormData, act: Act) => {
    setPressed(act);
    for (const [name, value] of Object.entries(carry)) formData.set(name, value);
    formData.set(ACT_FIELD, act);
    if (replayField !== undefined) formData.set(replayField, replayKeyFor(formData));
    if (botCheck === undefined) submit(formData);
    else void checked(formData);
  };

  return (
    <ClassicPage width="form">
      {head}
      <HeldForm
        ref={form}
        validationErrors={refused?.fieldErrors}
        onInvalid={block}
        onSend={(formData) => {
          if (!isBusy) send(formData, "primary");
        }}
        className="grid gap-6">
        {children !== undefined && (boxes ? <div className={boxStack()}>{children}</div> : <FieldStack>{children}</FieldStack>)}
        {/* One item of the form's gap: a widget Cloudflare shows nothing in leaves no gap of its own. */}
        <div className="grid">
          {check.widget}
          {/* Full width on a phone; from `lg` each act as wide as its label, centred in the column, as a status card
              sets its way on, with the status line centred under them. */}
          <div className="grid gap-3 lg:justify-items-center lg:text-center">
            {/* The acts leave with the form as its end takes the page's place, and hand the focus to the end's title,
                so a screen reader hears what the press did. */}
            <RowActs className="contents">
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
                    if (form.current !== null && !isBusy) send(new FormData(form.current), "secondary");
                  }}
                />
              )}
            </RowActs>
            <StatusLine
              status={status}
              placement="column"
            />
          </div>
        </div>
      </HeldForm>
    </ClassicPage>
  );
}
