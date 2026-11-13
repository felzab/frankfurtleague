import type { ReactNode } from "react";

/** The sign-in once its session is read: the page's client view, which places `SignInPage`. */
async function SignInBody({ view }: { view: Promise<ReactNode> }) {
  return await view;
}

/**
 * The sign-in template's server half, around the client one, `SignInPage`, which holds a step's state and so
 * cannot wait on the server: it awaits the view the page reads, handed to it as a promise. The view is read per
 * request, so the whole column waits for it and the page arrives whole with it.
 */
export function SignInShell({ view }: { view: Promise<ReactNode> }) {
  return <SignInBody view={view} />;
}
