import { Suspense } from "react";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { ClassicPage, ClassicTitle } from "./ClassicPage";
import { Facts } from "./Facts";
import { OneShotEnd, OneShotForm } from "./OneShot";
import { Skeleton, SkeletonTitle } from "./Skeleton";
import { StatusPage } from "./StatusPage";

import type { Copy } from "@/core/copy";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Fact } from "./Facts";
import type { EndState, OneShotAction } from "./OneShot";
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
  return { tone: "warn", title: COPY.template.linkInvalid, sentence: COPY.shared.end.linkInvalid, next: next };
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
 * - `alreadyDone`: the link opened again, saying what the person did and when, with the one place to
 *   change it where there is one, on the danger tint where what they did was to decline;
 * - `ungueltig`: an expired, mistyped or tampered link alike, with the one sensible way on and no resend;
 * - `ende`: an end the page names itself before any answer, as a deletion link opened signed out.
 */
export type MailedState =
  | {
      state: "question";
      title: Copy;
      facts?: ReadonlyArray<Fact>;
      sentence: Copy;
      action: OneShotAction;
      acts: { primary: Copy; secondary?: Copy };
      /** What the form posts unseen beside its fields: the link's token. */
      carry: Readonly<Record<string, string>>;
      /** The main act asks the passkey touch first, for a person holding a passkey. */
      touch?: boolean;
      /** The answer's fields, the kit's, each with its `name`. */
      children?: ReactNode;
    }
  | { state: "alreadyDone"; title: Copy; sentence: Copy; next: StatusCardProps["next"]; declined?: boolean }
  | { state: "ungueltig"; next: StatusCardProps["next"] }
  | ({ state: "ende" } & EndState)
  // Redesign: goes with the address change's old view, which the administrator's way keeps until session 7.
  | { state: "alt"; view: ReactNode };

/** The page once its link is read, in the boundary's place. */
async function MailedBody({ page }: { page: Promise<MailedState> }) {
  const props = await page;
  switch (props.state) {
    case "alt":
      return props.view;
    case "ungueltig":
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
          sentence={props.sentence}
          next={props.next}
        />
      );
    case "ende":
      return (
        <StatusPage
          frame="classic"
          tone={props.tone}
          title={props.title}
          sentence={props.sentence}
          next={props.next}
        />
      );
    case "question":
      return (
        <OneShotForm
          action={props.action}
          acts={props.acts}
          carry={props.carry}
          touch={props.touch}
          head={
            <>
              <ClassicTitle text={props.title} />
              {props.facts !== undefined && props.facts.length > 0 && <Facts facts={props.facts} />}
              <p className="text-base">{props.sentence}</p>
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
 * meanwhile the column holds a bar where the title will stand and the skeleton of the facts, as the sign-in waits.
 */
export function MailedPage({ page }: { page: Promise<MailedState> }) {
  return (
    // Outermost, so neither the state a done answer's re-render reads nor the boundary waiting for it takes the end.
    <OneShotEnd>
      <Suspense
        fallback={
          <ClassicPage width="form">
            <SkeletonTitle />
            <Skeleton shape="facts" />
          </ClassicPage>
        }>
        <MailedBody page={page} />
      </Suspense>
    </OneShotEnd>
  );
}
