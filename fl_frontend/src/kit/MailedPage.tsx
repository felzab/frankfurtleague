import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";

import { ClassicTitle, PageHead } from "./ClassicPage";
import { Facts } from "./Facts";
import { Link } from "./Link";
import { OneShotEnd, OneShotForm } from "./OneShot";
import { ClassicStatusPage } from "./StatusCard";

import type { Copy, TextLink } from "@/core/copy";
import type { ReactNode } from "react";
import type { Fact } from "./Facts";
import type { EndState, OneShotActs, OneShotRun } from "./OneShot";
import type { WayOn } from "./StatusCard";

// The end a mailed page's answer reaches, handed on from the one-shot submit, which no page imports but this template.
export type { EndState } from "./OneShot";

/**
 * The way on from a mailed page to Konto's Anmeldung, where a change is started again and the deletion asked for:
 * every mailed end leading to Konto takes it.
 */
export const TO_ACCOUNT = { label: COPY.shared.end.toAccount, href: ROUTES.accountSignIn.path() } as const satisfies WayOn;

/**
 * What a mailed page shows once its link is read, the question or an end:
 *
 * - `question`: the question, opening on its act: a title, the facts the answer rests on, one sentence, the
 *   fields where the answer needs any, and the acts, sent once with the token the page carries, the main one
 *   behind the passkey touch where the act takes it; the answer replaces the page by the status template (the
 *   done state, worded by the server), or leads to a done page of its own where it forgets the link;
 * - `end`: an end the page names before any answer, drawn by the status template: the link opened again, its title
 *   saying what the person did and when, with the one place to change it where there is one, on the danger tint
 *   where what they did was to decline; a link no longer valid (`linkInvalid`), with the one sensible way on and no
 *   resend; or an end of the page's own, as a deletion link opened signed out.
 *
 * A press refused with a code naming an end, the record's or the link's, reaches an `end` state, never the stale-page
 * line: where an answer stands, the first one forgot the link in that browser, so the page read again there would show
 * the link no longer valid rather than the end. A code saying the link is spent or lapsed is about the link, so
 * whatever stands behind it the press reaches the link no longer valid. A code saying that some end stands, without
 * naming which, is classed by the link's view, read after the refusal: as the end the press asked where the view shows
 * it, as another end where the view shows another, and as the link no longer valid where it shows none. A code saying
 * the end the press asked already holds reaches that end's done page, which names the answer's kind; a confirmation's
 * adds that the earlier choices stand (`SERVER_COPY.entryConfirmation.choicesKept`), since the record keeps the first
 * press's choices rather than this one's, so the page stays true whichever press's choices are stored, as the contact
 * person's, the referee's and the pupil's answers reach it. A code saying another end stands reaches the link opened
 * again naming that end, read off the link's view where the code names neither and worded by the catalogue's `doneOn`,
 * as `fl_frontend/src/app/(classic)/confirm/linkView.ts :: alreadyDone` composes it. The contact person's answer
 * (`fl_frontend/src/app/(classic)/confirm/kontakt/answerKontakt.ts :: ended`) meets all three on
 * `bewerbung_seat_already_answered`: the done page where the view shows the answer pressed, the link opened again where
 * it shows the other, and the link no longer valid where it shows none. The address change's answer reaches the link no
 * longer valid on every refusal, so its link tells its holder nothing of who holds an address.
 *
 * A press reaching its own act's end, or the link opened again, forgets the link in that browser (`forgetMailedLink`),
 * as the privacy notice says of a link once used. One reaching the link no longer valid, or any other end, leaves the
 * cookie to lapse within its hour, since that press used nothing the link holds.
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
      /** The words closing the sentence, around the privacy notice's link. */
      more?: PrivacyMore;
      run: OneShotRun;
      acts: OneShotActs;
      /** What the form posts unseen beside its fields: the link's token. */
      carry: Readonly<Record<string, string>>;
      /** The main act's press asks the passkey touch for the address the page was drawn for, an administrator's. */
      touch?: { holder: string };
      /** The bot check's public key, on a page no link's token admits. */
      botCheck?: { siteKey: string };
      /** The form posts a replay key, where a press whose answer was lost may have landed (`OneShotForm`'s `replays`). */
      replays?: boolean;
      /** The fields stand in `Section` boxes, filling the column. */
      boxes?: boolean;
      /** A sentence the press rests on, at the footer's start beside the acts (`OneShotForm`'s `note`). */
      note?: ReactNode;
      /** The id of the words describing the acts to a screen reader, such as `note`'s own. */
      describedBy?: string;
      /** The answer's fields, the kit's, each with its `name`. */
      children?: ReactNode;
    }
  | ({ state: "end" } & EndState);

type PrivacyMore = (link: TextLink) => readonly [Copy, TextLink, Copy];

/** The sentence's close, after a space: the catalogue's words around the privacy notice's link. */
function More({ more }: { more: PrivacyMore }) {
  const [before, link, after] = more({ href: ROUTES.privacyNotice.path(), label: COPY.page.privacyNotice });
  return (
    <>
      {" "}
      {before}
      <Link
        href={link.href}
        placement="text"
        label={link.label}
      />
      {after}
    </>
  );
}

async function MailedBody({ page }: { page: Promise<MailedState> }) {
  const props = await page;
  switch (props.state) {
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
          run={props.run}
          acts={props.acts}
          carry={props.carry}
          touch={props.touch}
          botCheck={props.botCheck}
          replays={props.replays}
          boxes={props.boxes}
          note={props.note}
          describedBy={props.describedBy}
          head={
            <>
              {/* A form of boxes heads the page as every classic page does; a question holds its title in its card. */}
              {props.boxes === true ? <PageHead title={props.title} /> : <ClassicTitle text={props.title} />}
              {props.facts !== undefined && props.facts.length > 0 && (
                <Facts
                  facts={props.facts}
                  look={props.boxes === true ? "boxed" : "free"}
                />
              )}
              {props.sentence !== undefined && (
                <p className="text-base">
                  {props.sentence}
                  {props.more !== undefined && <More more={props.more} />}
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
 * The one shape of the pages a mail opens and of the application's address naming no season: a question in one card, or
 * a form of boxes in the classic frame's form column (`OneShotForm`). Its state is a function of what the page's read
 * returns, so the whole page waits for the read and arrives whole with it.
 */
export function MailedPage({ page }: { page: Promise<MailedState> }) {
  return (
    // Outermost, so the state a done answer's re-render reads never takes the end.
    <OneShotEnd>
      <MailedBody page={page} />
    </OneShotEnd>
  );
}
