import { COPY } from "@/core/copy";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Copy } from "@/core/copy";
import type { RouteEntry } from "@/core/routes";
import type { Metadata, ResolvingMetadata } from "next";
import type { EndState, MailedState } from "./MailedPage";
import type { StatusCardProps } from "./StatusCard";

/*
 * What a mailed page's link reads as, for the modules that word it without drawing the page: its tab's title and the
 * end a link no longer valid reaches. Apart from `MailedPage.tsx`, whose one-shot form brings the
 * client's stack to every route importing it.
 */

/**
 * The link no longer valid, one message for an expired, mistyped or tampered link alike, as the page opens on it
 * and as a press ends on it where the link stopped holding since the page opened.
 */
export function linkInvalid(next: StatusCardProps["next"]): EndState {
  return { tone: "warn", title: COPY.template.linkInvalid, next };
}

/** A mailed page's tab title, its state's own heading, so the tab never asks a question the page has closed. */
function mailedTitle(state: MailedState): Copy {
  switch (state.state) {
    case "invalid":
      return COPY.template.linkInvalid;
    case "question":
    case "alreadyDone":
    case "end":
      return state.title;
  }
}

/**
 * A mailed page's metadata, titled by its state. `state` is the same read as the page's, which the page memoizes with
 * React's `cache`, since a link's state decides its heading.
 */
export async function mailedMetadata(
  parent: ResolvingMetadata,
  row: RouteEntry & { readonly path: () => `/${string}` },
  state: Promise<MailedState>,
): Promise<Metadata> {
  return pageMetadata(parent, row, row.path(), { title: mailedTitle(await state) });
}
