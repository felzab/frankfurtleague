"use client";

import { Form } from "react-aria-components/Form";
import { tv } from "tailwind-variants/lite";

import { Button } from "./Button";
import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { CodeField } from "./CodeField";
import { Link } from "./Link";
import { TextField } from "./TextField";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";

/** A press the view offers: its words, the spinner while it runs, and what it does. */
type Act = { label: Copy; onPress: () => void; isBusy?: boolean; isDisabled?: boolean };

/** What every view says first: its heading, and the one line under its acts for what went wrong. */
type Head = {
  titel: Copy;
  /** The view's failure, worded by the catalogue; `null` keeps the line empty, holding its place. */
  zeile: Copy | null;
};

/** The e-mail view: the address field, „Code senden“, the „oder“ divider, the passkey by its button alone. */
type AdressView = Head & {
  view: "adresse";
  adresse: {
    label: Copy;
    value: string;
    onChange: (value: string) => void;
    /** The address the server refused for its form, in the field's own line. */
    fehler?: Copy;
  };
  /** The bot check guarding the send, standing before it as Cloudflare's example places it. */
  pruefung: ReactNode;
  senden: Act;
  oder: Copy;
  passkey: Act;
};

/** The code view: the address inside the sentence, the six boxes, and one press to use another address. */
type CodeView = Head & {
  view: "code";
  satz: Copy;
  code: {
    label: Copy;
    /** Counts the code's refusals: each one empties the boxes for the next code. */
    versuch: number;
    isDisabled: boolean;
    onComplete: (code: string) => void;
  };
  zurueck: Act;
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

/** `/signin` for somebody signed in: who they are, the way on, and signing out. */
type AngemeldetView = Head & {
  view: "angemeldet";
  satz: Copy;
  weiter: { label: Copy; href: Route };
  abmelden: Act;
};

export type SignInView = AdressView | CodeView | PasskeyView | AngemeldetView;

const look = tv({
  slots: {
    column: "flex flex-col gap-6 text-center",
    head: "grid justify-items-center gap-3",
    sentence: "text-base text-fg",
    address: "text-base font-semibold break-all text-fg",
    acts: "grid gap-3",
    form: "grid gap-4 text-left",
    divider: "flex items-center gap-3 text-xs text-fg-muted",
    rule: "h-px flex-1 bg-border",
    line: "min-h-5 text-sm text-danger",
  },
});

/**
 * The sign-in template, centred as the prototype drew it: the heading, the sentences, the address and the code
 * boxes centred, every button full width. Each view is one step of a sign-in; the page holding its state
 * passes the view it is on. Every outcome stands in the one line under the acts, so nothing above it moves.
 */
export function SignInPage(props: SignInView) {
  const slots = look();
  return (
    // The sign-in fills the first screen, so the footer starts just below it; the card width centres the
    // column in it.
    <ClassicPage
      width="card"
      fillsScreen>
      <div className={slots.column()}>
        <Body {...props} />
        {/* An alert standing from the first render, so a failure written into it is announced at once: it
            answers a press the reader just made. */}
        <p
          role="alert"
          className={slots.line()}>
          {/* The code view's line is the code field's own, under the boxes. */}
          {props.view === "code" ? null : props.zeile}
        </p>
      </div>
    </ClassicPage>
  );
}

function Body(props: SignInView) {
  const slots = look();

  switch (props.view) {
    case "adresse": {
      const { adresse, senden, passkey } = props;
      return (
        <>
          <ClassicTitle text={props.titel} />
          <Form
            validationErrors={adresse.fehler === undefined ? undefined : { email: adresse.fehler }}
            onSubmit={(event) => {
              event.preventDefault();
              senden.onPress();
            }}
            className={slots.form()}>
            <TextField
              label={adresse.label}
              name="email"
              width="W3"
              kind="email"
              autofill="username"
              // Not marked required: no record's type derives it, and an empty send meets the server's refusal of
              // its form in this line, as a malformed one meets the browser's.
              value={adresse.value}
              onChange={adresse.onChange}
            />
            {props.pruefung}
            <Button
              variant="primary"
              type="submit"
              label={senden.label}
              isBusy={senden.isBusy}
              isDisabled={senden.isDisabled}
            />
          </Form>
          {/* Decoration: the passkey's button carries its own name. */}
          <div
            aria-hidden
            className={slots.divider()}>
            <span className={slots.rule()} />
            {props.oder}
            <span className={slots.rule()} />
          </div>
          <div className={slots.acts()}>
            <Button
              variant="secondary"
              label={passkey.label}
              isBusy={passkey.isBusy}
              isDisabled={passkey.isDisabled}
              onPress={passkey.onPress}
            />
          </div>
        </>
      );
    }

    case "code": {
      const { code, zurueck } = props;
      return (
        <>
          {/* A status: the view replaces the form a press sent, so its heading and sentence are announced. */}
          <div
            role="status"
            className={slots.head()}>
            <ClassicTitle text={props.titel} />
            <p className={slots.sentence()}>{props.satz}</p>
          </div>
          <CodeField
            // Remounted on each refusal, so the boxes empty and the next six digits send by themselves.
            key={code.versuch}
            label={code.label}
            name="code"
            // The code's refusal stands under the boxes it refuses, in the field's own line.
            error={props.zeile ?? undefined}
            isDisabled={code.isDisabled}
            onComplete={code.onComplete}
          />
          <div className={slots.acts()}>
            <Button
              variant="secondary"
              label={zurueck.label}
              isBusy={zurueck.isBusy}
              isDisabled={zurueck.isDisabled}
              onPress={zurueck.onPress}
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
            <p className={slots.address()}>{props.adresse}</p>
          </div>
          <div className={slots.acts()}>
            <Button
              variant="primary"
              label={los.label}
              isBusy={los.isBusy}
              isDisabled={los.isDisabled}
              onPress={los.onPress}
            />
            {spaeter !== undefined && (
              <Button
                variant="quiet"
                label={spaeter.label}
                isBusy={spaeter.isBusy}
                isDisabled={spaeter.isDisabled}
                onPress={spaeter.onPress}
              />
            )}
          </div>
        </>
      );
    }

    case "angemeldet": {
      const { weiter, abmelden } = props;
      return (
        <>
          <div className={slots.head()}>
            <ClassicTitle text={props.titel} />
            <p className={slots.sentence()}>{props.satz}</p>
          </div>
          <div className={slots.acts()}>
            <Link
              href={weiter.href}
              placement="button"
              label={weiter.label}
            />
            <Button
              variant="secondary"
              label={abmelden.label}
              isBusy={abmelden.isBusy}
              isDisabled={abmelden.isDisabled}
              onPress={abmelden.onPress}
            />
          </div>
        </>
      );
    }
  }
}
