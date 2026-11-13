import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { ClassicTitle } from "./ClassicPage";
import { Facts } from "./Facts";
import { Link } from "./Link";
import { linkInvalid } from "./mailedLinkState";
import { OneShotEnd, OneShotForm } from "./OneShot";
import { ClassicStatusPage } from "./StatusCard";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { Fact } from "./Facts";
import type { EndState, OneShotAction, OneShotActs } from "./OneShot";
import type { StatusCardProps } from "./StatusCard";

// The end a mailed page's answer reaches, handed on from the one-shot submit, which no page imports but this template.
export type { EndState } from "./OneShot";

/**
 * The way on from a mailed page to Konto's Anmeldung, where a change is started again and the deletion asked for:
 * every mailed end leading to Konto takes it.
 */
export const TO_ACCOUNT = { label: COPY.shared.end.toAccount, href: ROUTES.accountSignIn.path() } as const satisfies StatusCardProps["next"];

/**
 * What a mailed page shows once its link is read, in one of four states, or an end of its own:
 *
 * - `question`: the question, opening on its act: a title, the facts the answer rests on, one sentence, the
 *   fields where the answer needs any, and the acts, sent once with the token the page carries, the main one
 *   behind the passkey touch where the act takes it; the answer replaces the page by the status template (the
 *   done state, worded by the server);
 * - `alreadyDone`: the link opened again, its title saying what the person did and when, with the one place to
 *   change it where there is one, on the danger tint where what they did was to decline;
 * - `invalid`: an expired, mistyped or tampered link alike, with the one sensible way on and no resend;
 * - `end`: an end the page names itself before any answer, as a deletion link opened signed out.
 */
export type MailedState =
  | {
      state: "question";
      title: Copy;
      facts?: ReadonlyArray<Fact>;
      /** None on the application form, whose title says all there is before its boxes. */
      sentence?: Copy;
      /** A second sentence, a paragraph of its own under the first: how long the answer waits. */
      sentenceAfter?: Copy;
      /** The words closing the sentence around the privacy notice's title, which stands between them as its link. */
      more?: { before: Copy; after: Copy };
      action: OneShotAction;
      acts: OneShotActs;
      /** What the form posts unseen beside its fields: the link's token. */
      carry: Readonly<Record<string, string>>;
      /** The main act's press asks the passkey touch ahead of its action, for a person holding a passkey. */
      touch?: boolean;
      /** The bot check's public key, on a page no link's token admits. */
      botCheck?: { siteKey: string };
      /** The field the form's replay key posts under, where a press whose answer was lost may have landed. */
      replayField?: string;
      /** The fields stand in `Section` boxes, filling the column. */
      boxes?: boolean;
      /** A sentence the press rests on, at the footer's start beside the acts (`OneShotForm`'s `note`). */
      note?: ReactNode;
      /** The id of the words describing the acts to a screen reader, such as `note`'s own. */
      describedBy?: string;
      /** The answer's fields, the kit's, each with its `name`. */
      children?: ReactNode;
    }
  | { state: "alreadyDone"; title: Copy; next: StatusCardProps["next"]; declined?: boolean }
  | { state: "invalid"; next: StatusCardProps["next"] }
  | ({ state: "end" } & EndState);

/** The page once its link is read. */
async function MailedBody({ page }: { page: Promise<MailedState> }) {
  const props = await page;
  switch (props.state) {
    case "invalid":
      return <ClassicStatusPage {...linkInvalid(props.next)} />;
    case "alreadyDone":
      return (
        <ClassicStatusPage
          tone={props.declined === true ? "danger" : "info"}
          title={props.title}
          next={props.next}
        />
      );
    case "end":
      return (
        <ClassicStatusPage
          tone={props.tone}
          title={props.title}
          next={props.next}
          quiet={props.quiet}
        />
      );
    case "question":
      return (
        <OneShotForm
          action={props.action}
          acts={props.acts}
          carry={props.carry}
          touch={props.touch}
          botCheck={props.botCheck}
          replayField={props.replayField}
          boxes={props.boxes}
          note={props.note}
          describedBy={props.describedBy}
          head={
            <>
              {/* A form of boxes holds its title on the page; a question holds it in its card. */}
              <ClassicTitle
                text={props.title}
                place={props.boxes === true ? "page" : "card"}
              />
              {props.facts !== undefined && props.facts.length > 0 && (
                <Facts
                  facts={props.facts}
                  look={props.boxes === true ? "boxed" : "free"}
                />
              )}
              {props.sentence !== undefined && (
                <p className="text-base">
                  {props.sentence}
                  {props.more !== undefined && (
                    <>
                      {" "}
                      {props.more.before}
                      <Link
                        href={ROUTES.privacyNotice.path()}
                        placement="text"
                        label={COPY.page.privacyNotice}
                      />
                      {props.more.after}
                    </>
                  )}
                </p>
              )}
              {props.sentenceAfter !== undefined && <p className="text-base">{props.sentenceAfter}</p>}
            </>
          }>
          {props.children}
        </OneShotForm>
      );
  }
}

/**
 * The one shape of the seven pages a mail opens: a question in one card, or a form of boxes in the classic frame's form
 * column (`OneShotForm`). Its state is a function of the link's token and the session beside it, so the whole page waits
 * for the read and arrives whole with it.
 */
export function MailedPage({ page }: { page: Promise<MailedState> }) {
  return (
    // Outermost, so the state a done answer's re-render reads never takes the end.
    <OneShotEnd>
      <MailedBody page={page} />
    </OneShotEnd>
  );
}
