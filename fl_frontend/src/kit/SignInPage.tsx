"use client";

import { useEffect, useRef } from "react";

import { Form } from "react-aria-components/Form";

import { Button } from "./Button";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { CodeField } from "./CodeField";
import { StatusLine } from "./FieldParts";
import { Link } from "./Link";
import { TextField } from "./TextField";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

/** A press the view offers: its words, the spinner while it runs, and what it does. */
type Act = { label: Copy; onPress: () => void; isBusy?: boolean; isDisabled?: boolean };

/** What every view says first: its heading, and the one line under its acts for what went wrong. */
type Head = {
  titel: Copy;
  /** The view's failure, worded by the catalogue; `null` keeps the line empty, holding its place. */
  row: Copy | null;
};

/** The e-mail view: the address field, „Code senden“, the „oder“ divider, the passkey by its button alone. */
type AdressView = Head & {
  view: "adresse";
  adresse: {
    label: Copy;
    value: string;
    onChange: (value: string) => void;
    /**
     * The server's refusal of the address, by the field's name `email`, in the field's own line: the answer's
     * own record, one per refusal, each of which moves the focus to the field.
     */
    error?: Readonly<Record<string, Copy>>;
  };
  /** The bot check guarding the send, standing before it as Cloudflare's example places it. */
  check: ReactNode;
  send: Act;
  or: Copy;
  passkey: Act;
};

/** The code view: the address set semibold inside the sentence, the six boxes, and one press to use another address. */
type CodeView = Head & {
  view: "code";
  /** The sentence's two parts around the address. */
  satz: { vor: Copy; nach: Copy };
  /** The address the code went to: data, not catalogue text. */
  adresse: string;
  code: {
    label: Copy;
    /** Counts the code's refusals: each one empties the boxes for the next code. */
    attempt: number;
    isDisabled: boolean;
    onComplete: (code: string) => void;
  };
  back: Act;
};

/** A passkey view: one sentence, the address, one primary press; the offer adds „Später“ as the quiet button. */
type PasskeyView = Head & {
  view: "passkey";
  satz: Copy;
  /** The account the passkey belongs to: data, not catalogue text. */
  adresse: string;
  los: Act;
  spaeter?: Act;
};

/** `/signin` for somebody signed in: who they are, the address set semibold inside the sentence, the way on, and signing out. */
type SignedInView = Head & {
  view: "angemeldet";
  /** The sentence's two parts around the address. */
  satz: { vor: Copy; nach: Copy };
  /** The account signed in: data, not catalogue text. */
  adresse: string;
  continue: { label: Copy; href: Route };
  signOut: Act;
};

export type SignInView = AdressView | CodeView | PasskeyView | SignedInView;

const look = tv({
  slots: {
    // 16 px between the blocks, as Vercel's measured sign-in sets them, so the column reads as one piece.
    column: "flex flex-col gap-4 text-center",
    head: "grid justify-items-center gap-3",
    sentence: "text-base text-fg",
    // Every address a view names: inside its sentence, or on its own line under a passkey sentence.
    marked: "font-semibold break-all",
    acts: "grid gap-3",
    form: "grid gap-4 text-left",
    divider: "flex items-center gap-3 text-xs text-fg-muted",
    rule: "h-px flex-1 bg-border",
  },
});

/**
 * The sign-in template, centred as the prototype drew it: the heading, the sentences, the address and the code
 * boxes centred, every button full width in the 352-px column. Each view is one step of a sign-in; the page
 * holding its state passes the view it is on. A refusal stands in the one line under the acts, the address's
 * and the code's in their field's own line.
 */
export function SignInPage(props: SignInView) {
  const slots = look();
  return (
    // The sign-in width centres the column in the first screen the classic page fills.
    <ClassicPage width="signin">
      <div className={slots.column()}>
        <Body {...props} />
        {/* The code view's refusal is the code field's own, under the boxes. */}
        <StatusLine
          status={props.view === "code" || props.row === null ? null : { tone: "error", text: props.row }}
          placement="column"
        />
      </div>
    </ClassicPage>
  );
}

function Body(props: SignInView) {
  const slots = look();

  switch (props.view) {
    case "adresse":
      return <AdressBody {...props} />;

    case "code": {
      const { code, back } = props;
      return (
        <>
          {/* A status: the view replaces the form a press sent, so its heading and sentence are announced. */}
          <div
            role="status"
            className={slots.head()}>
            <ClassicTitle text={props.titel} />
            <p className={slots.sentence()}>
              {props.satz.vor} <strong className={slots.marked()}>{props.adresse}</strong> {props.satz.nach}
            </p>
          </div>
          <CodeField
            // Remounted on each refusal, so the boxes empty and the next six digits send by themselves.
            key={code.attempt}
            label={code.label}
            name="code"
            // The code's refusal stands under the boxes it refuses, in the field's own line.
            error={props.row ?? undefined}
            isDisabled={code.isDisabled}
            onComplete={code.onComplete}
          />
          <div className={slots.acts()}>
            {/* The step aside from the view's one act, quiet as „Später“ is. */}
            <Button
              variant="quiet"
              {...back}
            />
          </div>
        </>
      );
    }

    case "passkey": {
      const { los, spaeter } = props;
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle text={props.titel} />
            <p className={slots.sentence()}>{props.satz}</p>
            <p className={slots.sentence()}>
              <strong className={slots.marked()}>{props.adresse}</strong>
            </p>
          </div>
          <div className={slots.acts()}>
            <Button
              variant="primary"
              {...los}
            />
            {spaeter !== undefined && (
              <Button
                variant="quiet"
                {...spaeter}
              />
            )}
          </div>
        </>
      );
    }

    case "angemeldet": {
      const { signOut } = props;
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle text={props.titel} />
            <p className={slots.sentence()}>
              {props.satz.vor} <strong className={slots.marked()}>{props.adresse}</strong> {props.satz.nach}
            </p>
          </div>
          <div className={slots.acts()}>
            <Link
              href={props.continue.href}
              placement="button"
              label={props.continue.label}
            />
            {/* The step out beside the way on, quiet as „Später“ is. */}
            <Button
              variant="quiet"
              {...signOut}
            />
          </div>
        </>
      );
    }
  }
}

/** The address view, whose field takes the focus on the server's refusal, as React Aria moves it on the browser's. */
function AdressBody({ titel, adresse, check, send: { onPress: send, ...button }, or, passkey }: AdressView) {
  const slots = look();
  const form = useRef<HTMLFormElement>(null);

  // The screen reader then reads the field with its refusal, which nothing else announces.
  useEffect(() => {
    if (adresse.error === undefined) return;
    const field = form.current?.elements.namedItem("email");
    if (field instanceof HTMLInputElement) field.focus();
  }, [adresse.error]);

  return (
    <>
      {/* The column's 16 px above the field, as the board drew the view. */}
      <ClassicTitle text={titel} />
      <Form
        ref={form}
        validationErrors={adresse.error}
        // The send's press is the form's submit, so `Enter` in the field sends too.
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className={slots.form()}>
        <TextField
          label={adresse.label}
          name="email"
          width="W3"
          kind="email"
          autofill="username"
          // The one field of the view, its two acts right under it: the line appears with the error alone.
          line="withError"
          // Not marked required: no record's type derives it, and an empty send meets the server's refusal of
          // its form in this line, as a malformed one meets the browser's.
          value={adresse.value}
          onChange={adresse.onChange}
        />
        {check}
        <Button
          variant="primary"
          type="submit"
          {...button}
        />
      </Form>
      {/* Decoration: the passkey's button carries its own name. */}
      <div
        aria-hidden
        className={slots.divider()}>
        <span className={slots.rule()} />
        {or}
        <span className={slots.rule()} />
      </div>
      <div className={slots.acts()}>
        <Button
          variant="secondary"
          {...passkey}
        />
      </div>
    </>
  );
}
