import { cache, Suspense } from "react";
import { notFound } from "next/navigation";

import { COPY } from "@/core/copy";
import { FLSonderereignis } from "@/core/generated/client/types";
import { SpielePatchSpielBody, spielePatchSpielBodyNotizOneMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { getAdminSpiel } from "@/features/spiele/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { pageMetadata } from "@/shared/utils/metadata";

import { spielortAnlegen } from "../../../../../spielortAnlegen";
import { SPIELORT_REGELN } from "../../../../../spielortRegeln";
import { SpielEditor } from "./SpielEditor";
import { spielSpeichern } from "./spielSpeichern";
import { KEIN_SONDEREREIGNIS, werteOf } from "./spielWerte";

import type { Copy } from "@/core/copy";
import type { FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { Metadata } from "next";

type Props = PageProps<"/bereich/verwaltung/saisons/[saison]/spiele/[spiel]">;

const WORTE = COPY.verwaltung.spiel;

const SONDEREREIGNISSE: Readonly<Record<FLSonderereignis, Copy>> = {
  ausgefallen: WORTE.ausgefallen,
  nichtantreten_team1: WORTE.nichtantretenTeam1,
  nichtantreten_team2: WORTE.nichtantretenTeam2,
  abgebrochen: WORTE.abgebrochen,
  annulliert: WORTE.annulliert,
};

/** The fixture the address names, read once for the tab's title and the page alike; `null` where none is. */
const lesen = cache(async (spiel: string) => {
  const id = CustomObjectIdStringSchema.safeParse(spiel);
  return id.success ? getAdminSpiel(id.data) : null;
});

/** A match is named by its two teams, as its own page is, and by its number while a side is still open. */
const nameOf = (spiel: FLSpielJoinedAdmin) =>
  spiel.team1 === null || spiel.team2 === null
    ? WORTE.nummer(spiel.spiel_nr)
    : ROUTES.verwaltungSpiel.title(spiel.team1.name, spiel.team2.name);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison, spiel } = await params;
  const gelesen = await lesen(spiel);
  return gelesen === null ? {} : pageMetadata(ROUTES.verwaltungSpiel, ROUTES.verwaltungSpiel.path(saison, spiel), nameOf(gelesen.spiel));
}

/** The match editor, on today's match read and write. */
export default function SpielEditorPage({ params }: Props) {
  return (
    <Suspense>
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: Pick<Props, "params">) {
  const { saison, spiel } = await params;
  // Retired venues included, so a match booked at one still names it.
  const [gelesen, { spielorte }] = await Promise.all([lesen(spiel), getSpielorte({ include_inactive: true })]);
  if (gelesen === null || gelesen.spiel.saison_id !== saison) notFound();
  const gespeichert = gelesen.spiel;
  // A retired venue can be booked anew by no match: it is listed only where it is already this match's.
  const gebucht = gespeichert.ort?.spielort_id ?? null;
  const waehlbar = spielorte.filter((ort) => ort.inactive_since === null || ort.id === gebucht);

  // A no-show needs both sides: while one is open, the write refuses it, so it is offered disabled.
  const beideSeiten = gespeichert.team1 !== null && gespeichert.team2 !== null;
  const sonderereignisse: Option[] = [
    { id: KEIN_SONDEREREIGNIS, label: WORTE.keines },
    ...Object.values(FLSonderereignis).map((ereignis): Option => {
      const label = SONDEREREIGNISSE[ereignis];
      const offen = !beideSeiten && (ereignis === "nichtantreten_team1" || ereignis === "nichtantreten_team2");
      return offen ? { id: ereignis, label, isDisabled: true, note: WORTE.beideSeitenNoetig } : { id: ereignis, label };
    }),
  ];

  return (
    <SpielEditor
      title={{ record: nameOf(gespeichert) }}
      record={{ id: gespeichert.id, version: gespeichert.version, values: werteOf(gespeichert) }}
      save={spielSpeichern}
      spielorte={waehlbar.map((ort) => ({
        // The match's own retired venue stays in the list, marked and not to be chosen again once left.
        option:
          ort.inactive_since === null
            ? { id: ort.id, label: ort.name }
            : { id: ort.id, label: ort.name, isDisabled: true, note: COPY.verwaltung.spielort.stillgelegt },
        mietpreis: ort.default_mietpreis,
      }))}
      sonderereignisse={sonderereignisse}
      notizHoechstens={spielePatchSpielBodyNotizOneMax}
      mietpreisPflicht={!SpielePatchSpielBody.shape.ort.options[0].shape.mietpreis.safeParse(null).success}
      spielortAnlegen={spielortAnlegen}
      spielortRegeln={SPIELORT_REGELN}
    />
  );
}
