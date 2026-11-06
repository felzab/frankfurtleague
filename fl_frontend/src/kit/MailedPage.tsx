import { Suspense } from "react";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { buttonPlaceholder } from "./buttonStyles";
import { ClassicPage, ClassicTitle, classicTitle } from "./ClassicPage";
import { Facts, FactsPlaceholder } from "./Facts";
import { Link } from "./Link";
import { OneShotEnd, OneShotForm } from "./OneShot";
import { SectionPlaceholder } from "./Section";
import { PlaceholderLine, Waiting } from "./Skeleton";
import { StatusPage } from "./StatusPage";

import type { Copy } from "@/core/copy";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Fact } from "./Facts";
import type { EndState, OneShotAction } from "./OneShot";
import type { FieldRow } from "./Section";
import type { StatusCardProps } from "./StatusPage";

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
      /** The words closing the sentence around the privacy notice's title, which stands between them as its link. */
      more?: { before: Copy; after: Copy };
      action: OneShotAction;
      acts: { primary: Copy; secondary?: Copy };
      /** What the form posts unseen beside its fields: the link's token. */
      carry: Readonly<Record<string, string>>;
      /** The main act asks the passkey touch first, for a person holding a passkey. */
      touch?: boolean;
      /** The bot check's public key, on a page no link's token admits. */
      botCheck?: { siteKey: string };
      /** The field the form's replay key posts under, where a press whose answer was lost may have landed. */
      replayField?: string;
      /** The fields stand in `Section` boxes, filling the column. */
      boxes?: boolean;
      /** The answer's fields, the kit's, each with its `name`. */
      children?: ReactNode;
    }
  | { state: "alreadyDone"; title: Copy; next: StatusCardProps["next"]; declined?: boolean }
  | { state: "invalid"; next: StatusCardProps["next"] }
  | ({ state: "end" } & EndState)
  // Redesign: goes with the address change's old view, which the administrator's way keeps until session 7.
  | { state: "legacy"; view: ReactNode };

/** The page once its link is read, in the boundary's place. */
async function MailedBody({ page }: { page: Promise<MailedState> }) {
  const props = await page;
  switch (props.state) {
    case "legacy":
      return props.view;
    case "invalid":
      return (
        <StatusPage
          frame="classic"
          {...linkInvalid(props.next)}
        />
      );
    case "alreadyDone":
      return (
        <StatusPage
          frame="classic"
          tone={props.declined === true ? "danger" : "info"}
          title={props.title}
          next={props.next}
        />
      );
    case "end":
      return (
        <StatusPage
          frame="classic"
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
            </>
          }>
          {props.children}
        </OneShotForm>
      );
  }
}

/**
 * The one shape of the seven pages a mail opens, in the classic frame's form column. Its state is a function of the
 * link's token and the session beside it, so the whole page waits for the read in the template's one boundary:
 * meanwhile the column holds the placeholders of the question, the state a link is opened on: its title, its facts,
 * its sentence and its act; a form in boxes its title, its boxes and its act.
 */
export function MailedPage({
  page,
  act,
  boxes,
}: {
  page: Promise<MailedState>;
  /** The main act's words, known before the read, which size the placeholder's button as the button that lands. */
  act: Copy;
  /** The rows of each box of a form in boxes, which the page alone knows, stated beside its read. */
  boxes?: ReadonlyArray<ReadonlyArray<FieldRow>>;
}) {
  return (
    // Outermost, so neither the state a done answer's re-render reads nor the boundary waiting for it takes the end.
    <OneShotEnd>
      <Suspense
        fallback={
          <ClassicPage width="form">
            <Waiting layout="flex flex-col gap-6">
              <PlaceholderLine
                text={classicTitle()}
                width="w-2/3"
              />
              {boxes === undefined ? (
                <>
                  <FactsPlaceholder pairs={4} />
                  <PlaceholderLine
                    text="text-base"
                    width="w-full"
                  />
                </>
              ) : (
                boxes.map((rows, index) => (
                  <SectionPlaceholder
                    // The boxes are fixed in number and order, so their place is their identity.
                    key={index}
                    rows={rows}
                  />
                ))
              )}
              <div className="grid gap-3 lg:justify-items-center">
                <span className={buttonPlaceholder()}>{act}</span>
                <span className="min-h-5" />
              </div>
            </Waiting>
          </ClassicPage>
        }>
        <MailedBody page={page} />
      </Suspense>
    </OneShotEnd>
  );
}
