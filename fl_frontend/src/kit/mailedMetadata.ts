import { COPY } from "@/core/copy/shared";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Copy } from "@/core/copy";
import type { RouteEntry } from "@/core/routes";
import type { Metadata } from "next";
import type { MailedState } from "./MailedPage";

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
 * React's `cache`, since a link's state decides its heading. Apart from `mailedLinkState`, which error boundaries
 * import: the share image `pageMetadata` spreads carries its alt from the server catalogue.
 */
export async function mailedMetadata(row: RouteEntry & { readonly path: () => `/${string}` }, state: Promise<MailedState>): Promise<Metadata> {
  return pageMetadata(row, { title: mailedTitle(await state) });
}
