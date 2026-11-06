"use client";

import { createContext, useContext, useState } from "react";

import type { ReactNode } from "react";

/** What a mint answers and no later read serves back: the row it wrote, and the link value itself. */
export type FreshInvitation = { invitationId: string; token: string; link: string };

type LinkHolding = {
  fresh: FreshInvitation | null;
  setFrisch: (next: FreshInvitation | null) => void;
};

const InvitationLinkContext = createContext<LinkHolding | undefined>(undefined);

/**
 * **Held above the editor's keyed subtree**, so a save on another panel of the team form cannot
 * take the one copy of the link with it.
 */
export function InvitationLinkHolder({ scope, children }: { scope: string; children: ReactNode }) {
  // Nothing about the value reaches browser storage, the URL or a cookie: it is a bearer
  // credential, and each of those outlives the page that minted it.
  const [held, setHeld] = useState<{ scope: string; fresh: FreshInvitation | null }>({ scope: scope, fresh: null });

  // Adjusted during the render that brings the new scope rather than in an effect: another team or
  // season is another link, and an effect would hand the old one to the new page first.
  if (held.scope !== scope) setHeld({ scope: scope, fresh: null });

  const holding: LinkHolding = {
    fresh: held.scope === scope ? held.fresh : null,
    setFrisch: (next) => {
      setHeld({ scope: scope, fresh: next });
    },
  };

  return <InvitationLinkContext.Provider value={holding}>{children}</InvitationLinkContext.Provider>;
}

export function useInvitationLink(): LinkHolding {
  const held = useContext(InvitationLinkContext);
  if (held === undefined) {
    throw new Error("useInvitationLink must be used within an InvitationLinkHolder");
  }
  return held;
}
