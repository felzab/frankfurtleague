import { notFound } from "next/navigation";

import { runAdminRead } from "@/shared/utils/adminRead";
import { metadataFor, NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

/** Nothing to read at such an address, judged as an administration read is, so a person with no rights is turned away. */
const judged = () => runAdminRead(async () => null);

export async function generateMetadata(): Promise<Metadata> {
  return metadataFor(judged(), () => NOT_FOUND_METADATA);
}

/**
 * Every administration address no page holds. An address no route matches is the root's to answer, which draws the
 * site's bare not-found card outside every frame; matched here, the request is judged as every administration page
 * judges it, and it ends in the administration's own not-found page, inside the administration's frame.
 */
export default async function UnknownAdminPage(): Promise<never> {
  await judged();
  notFound();
}
