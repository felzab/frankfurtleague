"use client";

import { createContext, useContext, useState } from "react";

import type { ReactNode } from "react";

/** What a mint answers and no later read serves back: the row it wrote, and the link value itself. */
export type FrischeEinladung = { einladungId: string; token: string; link: string };

type Halterung = {
  frisch: FrischeEinladung | null;
  setFrisch: (next: FrischeEinladung | null) => void;
};

const EinladungLinkContext = createContext<Halterung | undefined>(undefined);

/**
 * **Held above the editor's keyed subtree**, so a save on another panel of the team form cannot
 * take the one copy of the link with it.
 */
export function EinladungLinkHolder({ scope, children }: { scope: string; children: ReactNode }) {
  // Nothing about the value reaches browser storage, the URL or a cookie: it is a bearer
  // credential, and each of those outlives the page that minted it.
  const [held, setHeld] = useState<{ scope: string; frisch: FrischeEinladung | null }>({ scope: scope, frisch: null });

  // Adjusted during the render that brings the new scope rather than in an effect: another team or
  // season is another link, and an effect would hand the old one to the new page first.
  if (held.scope !== scope) setHeld({ scope: scope, frisch: null });

  const halterung: Halterung = {
    frisch: held.scope === scope ? held.frisch : null,
    setFrisch: (next) => {
      setHeld({ scope: scope, frisch: next });
    },
  };

  return <EinladungLinkContext.Provider value={halterung}>{children}</EinladungLinkContext.Provider>;
}

export function useEinladungLink(): Halterung {
  const held = useContext(EinladungLinkContext);
  if (held === undefined) {
    throw new Error("useEinladungLink must be used within an EinladungLinkHolder");
  }
  return held;
}
