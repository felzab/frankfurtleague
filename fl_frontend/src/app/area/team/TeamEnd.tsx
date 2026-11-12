"use client";

import { useParams } from "next/navigation";

import { useFrameSaison } from "@/kit/FrameNav";

import type { ReactNode } from "react";

/**
 * Which of a team page's two ends its not-found boundary draws. A page's read ends there both for a record the team
 * does not hold and for a team the person holds no seat on, and the boundary is handed neither the address nor the
 * reason, so the choice is read here from the seats the frame already holds: `refused` unless the person holds the
 * address's team in the address's season, the question the page's read asked.
 */
export function TeamEnd({ missing, refused }: { missing: ReactNode; refused: ReactNode }) {
  const held = useFrameSaison();
  const { saison } = useParams();
  return held !== null && held.entries.some((entry) => entry.id === saison) ? missing : refused;
}
