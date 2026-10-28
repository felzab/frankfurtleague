import { COPY } from "@/core/copy";

import { ClassicTitle } from "./ClassicPage";
import { Facts } from "./Facts";
import { OneShotForm } from "./OneShot";
import { StatusPage } from "./StatusPage";

import type { Copy } from "@/core/copy";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Fact } from "./Facts";
import type { OneShotAction } from "./OneShot";
import type { StatusCardProps } from "./StatusPage";

/**
 * Every page a mail opens carries its link's token in its address: no outbound request may send that
 * address on as its referrer. The one layout around the seven pages exports this as its metadata.
 */
export const MAILED_PAGE_METADATA = { referrer: "no-referrer" } as const satisfies Metadata;

/**
 * The one shape of the seven pages a mail opens, in the classic frame's form column, in one of four states:
 *
 * - `frage`: the question, opening on its act: a title, the facts the answer rests on, one sentence, the
 *   fields where the answer needs any, and the acts, sent once; the answer replaces the page by the status
 *   template (the done state, worded by the server);
 * - `schonErledigt`: the link opened again, saying what the person did and when, with the one place to
 *   change it where there is one;
 * - `ungueltig`: an expired, mistyped or tampered link alike, with the one sensible way on and no resend.
 */
export function MailedPage(
  props:
    | {
        state: "frage";
        title: Copy;
        facts?: ReadonlyArray<Fact>;
        sentence: Copy;
        action: OneShotAction;
        acts: { primary: Copy; secondary?: Copy };
        /** The answer's fields, the kit's, each with its `name`. */
        children?: ReactNode;
      }
    | { state: "schonErledigt"; title: Copy; sentence: Copy; next: StatusCardProps["next"] }
    | { state: "ungueltig"; next: StatusCardProps["next"] },
) {
  switch (props.state) {
    case "ungueltig":
      return (
        <StatusPage
          frame="classic"
          mark="warnung"
          title={COPY.vorlage.linkUngueltig}
          sentence={COPY.shared.ende.linkUngueltig}
          next={props.next}
        />
      );
    case "schonErledigt":
      return (
        <StatusPage
          frame="classic"
          mark="info"
          title={props.title}
          sentence={props.sentence}
          next={props.next}
        />
      );
    case "frage":
      return (
        <OneShotForm
          action={props.action}
          acts={props.acts}
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
