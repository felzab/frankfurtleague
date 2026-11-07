"use client";

import { useSearchParams } from "next/navigation";

import { SAISON_PARAM } from "@/shared/utils/saisonHref";

/** The season the shell is showing, straight off the live url. Null where the default is in force. */
export function useSaisonId(): string | null {
  return useSearchParams().get(SAISON_PARAM);
}
