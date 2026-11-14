import { notFound } from "next/navigation";

import { MailedPage } from "@/kit/MailedPage";

import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { formStateOf, readForm } from "./form";

import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/bewerbung/[saison]">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  const row = ROUTES.bewerbung;
  return metadataFor(readForm(saison), () => pageMetadata(parent, row, row.path(saison), { title: row.title(saison) }));
}

async function readState(params: Props["params"]): Promise<MailedState> {
  const { saison } = await params;
  const form = await readForm(saison);
  if (form === null) notFound();
  return formStateOf(saison, form);
}

/**
 * `/bewerbung/<saison>`, the public application form: one page of five boxes sent once through the one-shot submit, its
 * outcome replacing the form. Where no form stands, the page is its status card: not yet open, closed or paused, the
 * season over, no window.
 */
export default function BewerbungPage({ params }: Props) {
  return <MailedPage page={readState(params)} />;
}
