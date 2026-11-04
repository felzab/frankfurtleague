import { Suspense } from "react";

import { SignInSkeleton } from "./SignInPage";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/** The sign-in once its session is read: the page's client view, which places `SignInPage`. */
async function SignInBody({ view }: { view: Promise<ReactNode> }) {
  return await view;
}

/**
 * The sign-in template's server half, around the client one, `SignInPage`, which holds a step's state and so
 * cannot wait on the server: the sign-in's one boundary. The view is a function of the request's session, so the
 * whole column waits for it; meanwhile the skeleton stands with the view's title where the page knows it before
 * the read, and a bar where the read names it. The page hands it the view it reads, as a promise. The skeleton
 * and the view are each a whole classic page, whose own fade carries the swap.
 */
export function SignInShell({ title, view }: { title: Copy | null; view: Promise<ReactNode> }) {
  return (
    <Suspense fallback={<SignInSkeleton title={title} />}>
      <SignInBody view={view} />
    </Suspense>
  );
}
