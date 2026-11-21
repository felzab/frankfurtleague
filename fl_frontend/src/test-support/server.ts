import { prerender } from "react-dom/static";

import type { ReactNode } from "react";

/**
 * `tree` as the server sends it once every read has landed, parsed into an element of the test's document. React sends
 * a finished Suspense boundary past `progressiveChunkSize` bytes, 12,800 unless set, as its fallback in its place and
 * its content in a hidden element at the end, which a script moves in. A parse into an element runs no script, so the
 * size is lifted and every boundary stands in its place, as a browser shows the page once that script has run.
 */
export async function drawnOnServer(tree: ReactNode): Promise<HTMLElement> {
  const { prelude } = await prerender(tree, { progressiveChunkSize: Number.MAX_SAFE_INTEGER });
  const page = document.createElement("div");
  page.innerHTML = await new Response(prelude).text();
  return page;
}
