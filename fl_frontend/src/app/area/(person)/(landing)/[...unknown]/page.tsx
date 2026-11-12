import { notFound } from "next/navigation";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

export const metadata: Metadata = NOT_FOUND_METADATA;

/**
 * Every address under a person's area no page holds, a pupil's and a referee's places' and a team's short of its season
 * among them. An address no route matches is the root's to answer, which draws the site's bare not-found card outside
 * every frame; matched here, it ends in the area's own not-found page, inside the frame of the area's landing.
 */
export default function UnknownAreaPage(): never {
  notFound();
}
