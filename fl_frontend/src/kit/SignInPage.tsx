"use client";

import { Button } from "./Button";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { CodeField } from "./CodeField";
import { StatusLine } from "./FieldParts";
import { FieldStack } from "./FieldStack";
import { FormFooter } from "./FormFooter";
import { HeldForm } from "./HeldForm";
import { TextField } from "./TextField";
import { tv } from "./tv";

import type { Copy, RecordText } from "@/core/copy";
import type { ReactNode } from "react";
import type { FieldFaults } from "./HeldForm";

type Press = { label: Copy; onPress: () => void; isBusy?: boolean; isDisabled?: boolean };

/** What every view says first: its heading, and the one line under its acts for what went wrong. */
type Head = {
  title: Copy;
  /** The view's failure, worded by the catalogue; `null` leaves the line saying nothing and taking no room. */
  row: Copy | null;
};

type AddressView = Head & {
  view: "address";
  address: {
    label: Copy;
    value: string;
    onChange: (value: string) => void;
    /**
     * The server's refusal of the address, by the field's name `email`, in the field's own line: the answer's
     * own record, one per refusal, each of which moves the focus to the field.
     */
    error?: FieldFaults;
  };
  /** The bot check guarding the send, standing before it as Cloudflare's example places it. */
  check: ReactNode;
  /** The send, handed the address the press left in the field. */
  send: Omit<Press, "onPress"> & { onPress: (address: string) => void };
  or: Copy;
  passkey: Press;
};

type CodeView = Head & {
  view: "code";
  /** The sentence around the address, which the view sets semibold. */
  sentence: (address: RecordText) => readonly [Copy, RecordText, Copy];
  /** The address the code went to: data, not catalogue text. */
  address: string;
  code: {
    label: Copy;
    /** The typed code's own refusal, a phrase under the boxes; every other refusal is the view's `row`. */
    error: Copy | null;
    /** Counts the code's refusals: each one empties the boxes for the next code. */
    attempt: number;
    /** The code is being checked, until the landing's document replaces the view or a refusal returns it. */
    isBusy: boolean;
    onComplete: (code: string) => void;
  };
  back: Press;
};

/** A passkey view: one sentence, the address, one primary press. */
type PasskeyView = Head & {
  view: "passkey";
  sentence: Copy;
  /** The account the passkey belongs to: data, not catalogue text. */
  address: string;
  go: Press;
};

export type SignInView = AddressView | CodeView | PasskeyView;

const look = tv({
  slots: {
    // 16 px between the blocks, as Vercel's measured sign-in sets them, so the column reads as one piece.
    column: "flex flex-col gap-4 text-center",
    head: "grid justify-items-center gap-3",
    sentence: "text-base text-fg",
    // Every address a view names: inside its sentence, or on its own line under a passkey sentence.
    marked: "font-semibold break-all",
    acts: "grid gap-3",
    form: "text-left",
    divider: "flex items-center gap-3 text-xs text-fg-muted",
    rule: "h-px flex-1 bg-border",
  },
});

/**
 * The sign-in template: the heading, the sentences, the address and the code boxes centred, every button full width in
 * the column. Each view is one step of a sign-in; the page holding its state passes the view it is on. A refusal
 * stands in the one line under the acts, the address's and the typed code's in their field's own line.
 */
export function SignInPage(props: SignInView) {
  const slots = look();
  return (
    // The sign-in width centres the column in the first screen the classic page fills.
    <ClassicPage width="signin">
      <div className={slots.column()}>
        <Body {...props} />
        <StatusLine
          status={props.row === null ? null : { tone: "danger", text: props.row }}
          placement="column"
        />
      </div>
    </ClassicPage>
  );
}

function Body(props: SignInView) {
  const slots = look();

  switch (props.view) {
    case "address":
      return <AddressBody {...props} />;

    case "code": {
      const { code, back } = props;
      const [before, address, after] = props.sentence({ record: props.address });
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle
              text={props.title}
              place="page"
            />
            <p className={slots.sentence()}>
              {before}
              <strong className={slots.marked()}>{address.record}</strong>
              {after}
            </p>
          </div>
          <CodeField
            // Remounted on each refusal, so the boxes empty and the next six digits send by themselves.
            key={code.attempt}
            label={code.label}
            name="code"
            // The typed code's refusal stands under the boxes it refuses, in the field's own line.
            error={code.error ?? undefined}
            isBusy={code.isBusy}
            onComplete={code.onComplete}
          />
          <div className={slots.acts()}>
            {/* The step aside from the view's one act, quiet. */}
            <Button
              variant="quiet"
              {...back}
            />
          </div>
        </>
      );
    }

    case "passkey": {
      const { go } = props;
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle
              text={props.title}
              place="page"
            />
            <p className={slots.sentence()}>{props.sentence}</p>
            <p className={slots.sentence()}>
              <strong className={slots.marked()}>{props.address}</strong>
            </p>
          </div>
          <div className={slots.acts()}>
            <Button
              variant="primary"
              {...go}
            />
          </div>
        </>
      );
    }
  }
}

/**
 * The address view, whose field takes the focus on either pass's refusal (`HeldForm`), so a screen reader reads it with
 * its phrase, which nothing else announces: the status line says nothing then, since it would only point at the field
 * in focus.
 */
function AddressBody({ title, address, check, send: { onPress: send, ...button }, or, passkey }: AddressView) {
  const slots = look();
  return (
    <>
      <ClassicTitle
        text={title}
        place="page"
      />
      <HeldForm
        fieldErrors={address.error}
        // The send's press is the form's submit, so `Enter` in the field sends too.
        isBusy={button.isBusy === true}
        onSend={(formData) => send(String(formData.get("email")))}
        className={slots.form()}>
        <FieldStack>
          <TextField
            label={address.label}
            name="email"
            kind="email"
            autofill="username"
            // Not marked required: no record's type derives it, and an empty send meets the server's refusal of
            // its form in this line, as a malformed one meets the browser's.
            value={address.value}
            onChange={address.onChange}
          />
          {check}
          <FormFooter place="column">
            <Button
              variant="primary"
              type="submit"
              {...button}
            />
          </FormFooter>
        </FieldStack>
      </HeldForm>
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
