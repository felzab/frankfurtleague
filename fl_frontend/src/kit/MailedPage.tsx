import { Suspense } from "react";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { buttonPlaceholder } from "./buttonStyles";
import { ClassicPage, ClassicTitle, classicTitle } from "./ClassicPage";
import { Facts, FactsPlaceholder } from "./Facts";
import { FieldStack } from "./FieldStack";
import { boxStack } from "./fieldStyles";
import { FormFooterPlaceholder } from "./FormFooter";
import { Link } from "./Link";
import { OneShotEnd, OneShotForm } from "./OneShot";
import { PlaceholderLine, PlaceholderSentence, Waiting } from "./Skeleton";
import { ClassicStatusPage, StatusPagePlaceholder } from "./StatusCard";

import type { Copy } from "@/core/copy";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Fact } from "./Facts";
import type { EndState, OneShotAction, OneShotActs } from "./OneShot";
import type { StatusCardProps } from "./StatusCard";

/**
 * A page a mail opens carries its link's token in its address, the first request of one in
 * `fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_PAGES` included: no outbound request may send that address on
 * as its referrer. Each such page spreads this into the metadata it answers, or sets the same referrer itself.
 */
export const MAILED_PAGE_METADATA = { referrer: "no-referrer" } as const satisfies Metadata;

// The end a mailed page's answer reaches, handed on from the one-shot submit, which no page imports but this template.
export type { EndState } from "./OneShot";

/**
 * The link no longer valid, one message for an expired, mistyped or tampered link alike, as the page opens on it
 * and as a press ends on it where the link stopped holding since the page opened.
 */
export function linkInvalid(next: StatusCardProps["next"]): EndState {
  return { tone: "warn", title: COPY.template.linkInvalid, next };
}

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

/**
 * A mailed page's tab title, its state's own heading, so the tab never asks a question the page has closed. Read off the
 * same read as the page, which the page memoizes with React's `cache`, since a link's state decides its heading.
 */
export function mailedTitle(state: MailedState): Copy {
  switch (state.state) {
    case "invalid":
      return COPY.template.linkInvalid;
    case "question":
    case "alreadyDone":
    case "end":
      return state.title;
  }
}

/** The page once its link is read, in the boundary's place. */
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
              <ClassicTitle text={props.title} />
              {props.facts !== undefined && props.facts.length > 0 && <Facts facts={props.facts} />}
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

/** What the question's wait knows of the page before the read, stated beside its read. */
type QuestionWait = {
  /** How many facts the question lists: a row the read decides, whose count the page states beside it as a list's. */
  facts: number;
  /** The main act's words, known before the read, which size the placeholder's button as the button that lands. */
  act: Copy;
  /** The refusal's words, where the question has one. */
  second?: Copy;
  /**
   * The sentence's words where they run past a line, set unseen, so it stands as many lines as it will at every width;
   * `false` where the question lands with no sentence most days, which leaves the wait none.
   */
  sentence?: string | false;
  /** The second sentence's words, set unseen, where the question stands one in a paragraph of its own. */
  sentenceAfter?: string;
  /** The placeholders of the answer's fields, where the question asks any. */
  fields?: ReactNode;
  /** The placeholder of the footer's note, where the question carries one. */
  note?: ReactNode;
  /** The fields' placeholders stand in `Section` boxes, laid out as the question's own boxes are. */
  boxes?: boolean;
};

/** The question while the read says what it asks: its title, its facts, its sentences, its fields and its acts. */
function QuestionPlaceholder({ facts, act, second, sentence, sentenceAfter, fields, note, boxes = false }: QuestionWait) {
  return (
    <ClassicPage width="form">
      <Waiting layoutClass="flex flex-col gap-6">
        <PlaceholderLine
          textClass={classicTitle()}
          widthClass="w-2/3"
        />
        {facts > 0 && <FactsPlaceholder pairs={facts} />}
        {sentence === undefined ? (
          <PlaceholderLine
            textClass="text-base"
            widthClass="w-full"
          />
        ) : (
          sentence !== false && (
            <PlaceholderSentence
              textClass="text-base"
              words={sentence}
            />
          )
        )}
        {sentenceAfter !== undefined && (
          <PlaceholderSentence
            textClass="text-base"
            words={sentenceAfter}
          />
        )}
        {/* `OneShotForm`'s own wrapper, so the fields stand where the question's land. */}
        {fields !== undefined && (boxes ? <div className={boxStack()}>{fields}</div> : <FieldStack>{fields}</FieldStack>)}
        <FormFooterPlaceholder note={note}>
          {second !== undefined && <span className={buttonPlaceholder()}>{second}</span>}
          <span className={buttonPlaceholder()}>{act}</span>
        </FormFooterPlaceholder>
      </Waiting>
    </ClassicPage>
  );
}

/**
 * The one shape of the seven pages a mail opens, in the classic frame's form column. Its state is a function of the
 * link's token and the session beside it, so the whole page waits for the read in the template's one boundary:
 * meanwhile the column holds the state that lands most often, as the classic frame's footer asks (`Skeleton.tsx`): the
 * question, the state a link is opened on, or `end`, the status card of a page that lands an end most days, as the
 * application form does outside its window.
 */
export function MailedPage(
  props: { page: Promise<MailedState> } & ((QuestionWait & { end?: never }) | { end: { title: Copy; next: Copy }; act?: never }),
) {
  return (
    // Outermost, so neither the state a done answer's re-render reads nor the boundary waiting for it takes the end.
    <OneShotEnd>
      <Suspense fallback={props.end === undefined ? <QuestionPlaceholder {...props} /> : <StatusPagePlaceholder {...props.end} />}>
        <MailedBody page={props.page} />
      </Suspense>
    </OneShotEnd>
  );
}
