import { SignInPlaceholder } from "./SignInPage";
import { PageWait } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/** The sign-in once its session is read: the page's client view, which places `SignInPage`. */
async function SignInBody({ view }: { view: Promise<ReactNode> }) {
  return await view;
}

/**
 * The sign-in template's server half, around the client one, `SignInPage`, which holds a step's state and so
 * cannot wait on the server: it awaits the view the page reads, handed to it as a promise. The view is read per
 * request, so the whole column waits for it, and under `WholePages` the page arrives whole with it. Outside
 * `WholePages` that wait is the sign-in's one boundary, drawn meanwhile as the view's placeholders, with its title where
 * the page knows it before the read and a bar where the read names it; the placeholder and the view are each a whole
 * classic page, whose own fade carries the swap.
 */
export function SignInShell({ title, view }: { title: Copy | null; view: Promise<ReactNode> }) {
  return (
    <PageWait fallback={<SignInPlaceholder title={title} />}>
      <SignInBody view={view} />
    </PageWait>
  );
}
