"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

import { SAISON_PARAM, withSaisonId } from "@/shared/utils/saisonHref";

/** The season the shell is showing, straight off the live url. Null where the default is in force. */
export function useSaisonId(): string | null {
  return useSearchParams().get(SAISON_PARAM);
}

/**
 * The client half of `withSaisonId`. Every admin navigation that is not itself season-scoped goes
 * through one or the other, so no link can quietly lose the season:
 * `fl_frontend/eslint.config.mjs :: SOURCE_BANS` refuses an `/bereich/admin` literal that is neither's first argument.
 */
export function useSaisonHref(): (path: string) => string {
  const saisonId = useSaisonId();

  return useCallback((path: string) => withSaisonId(path, saisonId), [saisonId]);
}
