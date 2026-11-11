"use client";

import { useEffect, useRef } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { buttonLook, buttonPlaceholder } from "./buttonStyles";
import { ClassicPage, ClassicTitle, classicTitle } from "./ClassicPage";
import { CodeField } from "./CodeField";
import { FieldPlaceholder } from "./FieldPair";
import { StatusLine } from "./FieldParts";
import { FieldStack } from "./FieldStack";
import { FormFooter, FormFooterPlaceholder } from "./FormFooter";
import { HeldForm } from "./HeldForm";
import { Link } from "./Link";
import { PlaceholderLine, Waiting } from "./Skeleton";
import { TextField } from "./TextField";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

/** A press the view offers: its words, the spinner while it runs, and what it does. */
type Act = { label: Copy; onPress: () => void; isBusy?: boolean; isDisabled?: boolean };

/** What every view says first: its heading, and the one line under its acts for what went wrong. */
type Head = {
  title: Copy;
  /** The view's failure, worded by the catalogue; `null` leaves the line saying nothing and taking no room. */
  row: Copy | null;
};

/** The e-mail view: the address field, „Code senden“, the „oder“ divider, the passkey by its button alone. */
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
    error?: Readonly<Record<string, Copy>>;
  };
  /** The bot check guarding the send, standing before it as Cloudflare's example places it. */
  check: ReactNode;
  /** The send, handed the address the press left in the field. */
  send: Omit<Act, "onPress"> & { onPress: (address: string) => void };
  or: Copy;
  passkey: Act;
};

/** The code view: the address set semibold inside the sentence, the six boxes, and one press to use another address. */
type CodeView = Head & {
  view: "code";
  /** The sentence's two parts around the address. */
  sentence: { before: Copy; after: Copy };
  /** The address the code went to: data, not catalogue text. */
  address: string;
  code: {
    label: Copy;
    /** The typed code's own refusal, a phrase under the boxes; every other refusal is the view's `row`. */
    error: Copy | null;
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
  sentence: Copy;
  /** The account the passkey belongs to: data, not catalogue text. */
  address: string;
  go: Act;
  later?: Act;
};

/** `/signin` for somebody signed in: who they are, the address set semibold inside the sentence, the way on, and signing out. */
type SignedInView = Head & {
  view: "signedIn";
  /** The sentence's two parts around the address. */
  sentence: { before: Copy; after: Copy };
  /** The account signed in: data, not catalogue text. */
  address: string;
  continue: { label: Copy; href: Route };
  signOut: Act;
};

export type SignInView = AddressView | CodeView | PasskeyView | SignedInView;

const look = tv({
  slots: {
    // 16 px between the blocks, as Vercel's measured sign-in sets them, so the column reads as one piece.
    column: "flex flex-col gap-4 text-center",
    head: "grid justify-items-center gap-3",
    sentence: "text-base text-fg",
    // Every address a view names: inside its sentence, or on its own line under a passkey sentence.
    marked: "font-semibold break-all",
    acts: "grid gap-3",
    // The address form's field, its bot check and its send in the form rule's rhythm (`FieldStack`, `FormFooter`).
    form: "text-left",
    divider: "flex items-center gap-3 text-xs text-fg-muted",
    rule: "h-px flex-1 bg-border",
  },
});

/**
 * The sign-in template, centred as the prototype drew it: the heading, the sentences, the address and the code
 * boxes centred, every button full width in the 352-px column. Each view is one step of a sign-in; the page
 * holding its state passes the view it is on. A refusal stands in the one line under the acts, the address's
 * and the typed code's in their field's own line.
 */
export function SignInPage(props: SignInView) {
  const slots = look();
  return (
    // The sign-in width centres the column in the first screen the classic page fills.
    <ClassicPage width="signin">
      <div className={slots.column()}>
        <Body {...props} />
        <StatusLine
          status={props.row === null ? null : { tone: "error", text: props.row }}
          placement="column"
        />
      </div>
    </ClassicPage>
  );
}

/**
 * The sign-in while its session is read, drawn with the step's own column and blocks as placeholders. Where the page
 * names the title before the read, the step is the address view, which shares that title with the signed-in view: the
 * title, the address field, „Code senden“, the „oder“ divider and the passkey's button. Where the title waits on the
 * read too, the passkey's step, in the offer's shape, which everyone but an administrator meets: the title's line, the
 * sentence's two lines, the address's line, its button and „Später“ under it, each in its place in the step's blocks.
 */
export function SignInPlaceholder({ title }: { title: Copy | null }) {
  const slots = look();
  return (
    <ClassicPage width="signin">
      <div className={slots.column()}>
        {title === null ? (
          <Waiting layoutClass="flex flex-col gap-4">
            <div className={slots.head()}>
              <PlaceholderLine
                textClass={classicTitle()}
                words={COPY.signIn.passkey.offer.title}
              />
              <span className="grid w-full justify-items-center">
                <PlaceholderLine
                  textClass={slots.sentence()}
                  widthClass="w-72"
                />
                <PlaceholderLine
                  textClass={slots.sentence()}
                  widthClass="w-40"
                />
              </span>
              <PlaceholderLine
                textClass={slots.sentence()}
                widthClass="w-48"
              />
            </div>
            <div className={slots.acts()}>
              <span className={buttonPlaceholder("w-full")} />
              <span className={buttonLook({ look: "quiet" })}>
                <PlaceholderLine
                  textClass=""
                  words={COPY.signIn.passkey.later}
                />
              </span>
            </div>
          </Waiting>
        ) : (
          <>
            <ClassicTitle text={title} />
            <Waiting layoutClass="flex flex-col gap-4">
              <div className={slots.form()}>
                <FieldStack>
                  <FieldPlaceholder />
                  {/* The bot check's place: it shows nothing unless it asks the visitor to act. */}
                  <span />
                  <FormFooterPlaceholder place="column">
                    <span className={buttonPlaceholder()} />
                  </FormFooterPlaceholder>
                </FieldStack>
              </div>
              <div className={slots.divider()}>
                <span className={slots.rule()} />
                <PlaceholderLine
                  textClass="text-xs"
                  widthClass="w-6"
                />
                <span className={slots.rule()} />
              </div>
              <div className={slots.acts()}>
                <span className={buttonPlaceholder("w-full")} />
              </div>
            </Waiting>
          </>
        )}
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
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle text={props.title} />
            <p className={slots.sentence()}>
              {props.sentence.before} <strong className={slots.marked()}>{props.address}</strong> {props.sentence.after}
            </p>
          </div>
          <CodeField
            // Remounted on each refusal, so the boxes empty and the next six digits send by themselves.
            key={code.attempt}
            label={code.label}
            name="code"
            // The typed code's refusal stands under the boxes it refuses, in the field's own line.
            error={code.error ?? undefined}
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
      const { go, later } = props;
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle text={props.title} />
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
            {later !== undefined && (
              <Button
                variant="quiet"
                {...later}
              />
            )}
          </div>
        </>
      );
    }

    case "signedIn": {
      const { signOut } = props;
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle text={props.title} />
            <p className={slots.sentence()}>
              {props.sentence.before} <strong className={slots.marked()}>{props.address}</strong> {props.sentence.after}
            </p>
          </div>
          <div className={slots.acts()}>
            <Link
              href={props.continue.href}
              placement="button"
              look="primary"
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
function AddressBody({ title, address, check, send: { onPress: send, ...button }, or, passkey }: AddressView) {
  const slots = look();
  const form = useRef<HTMLFormElement>(null);

  // The screen reader then reads the field with its refusal, which nothing else announces.
  useEffect(() => {
    if (address.error === undefined) return;
    const field = form.current?.elements.namedItem("email");
    if (field instanceof HTMLInputElement) field.focus();
  }, [address.error]);

  return (
    <>
      {/* The column's 16 px above the field, as the board drew the view. */}
      <ClassicTitle text={title} />
      <HeldForm
        ref={form}
        validationErrors={address.error}
        // The send's press is the form's submit, so `Enter` in the field sends too.
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
