import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { COPY } from "@/core/copy";
import { FLSonderereignis } from "@/core/generated/client/types";
import { SpielePatchSpielBody, spielePatchSpielBodyNotizOneMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSpiel } from "@/features/spiele/queries";
import { getSpielorte } from "@/features/spielorte/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import { spielortAnlegen } from "../../../../../spielortAnlegen";
import { SPIELORT_REGELN } from "../../../../../spielortRegeln";
import { SpielEditor } from "./SpielEditor";
import { spielSpeichern } from "./spielSpeichern";
import { KEIN_SONDEREREIGNIS, werteOf } from "./spielWerte";

import type { Copy } from "@/core/copy";
import type { FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/bereich/verwaltung/saisons/[saison]/spiele/[spiel]">;

const WORTE = COPY.verwaltung.spiel;

const SONDEREREIGNISSE: Readonly<Record<FLSonderereignis, Copy>> = {
  ausgefallen: WORTE.ausgefallen,
  nichtantreten_team1: WORTE.nichtantretenTeam1,
  nichtantreten_team2: WORTE.nichtantretenTeam2,
  abgebrochen: WORTE.abgebrochen,
  annulliert: WORTE.annulliert,
};

/** One read of the fixture for the tab's title and the page alike. */
const lesen = cache(getAdminSpiel);

/**
 * The fixture the address names, as every season page reads its record: not-found for a malformed id, for none
 * by it, and for one of another season, the tab's title included.
 */
async function readSpiel(params: Props["params"]) {
  const spiel = await resolveObjectIdParam(params, "spiel");
  const { saison } = await params;
  const gelesen = await lesen(spiel);
  if (gelesen === null || gelesen.spiel.saison_id !== saison) notFound();
  return gelesen;
}

/** A match is named by its two teams, as its own page is, and by its number while a side is still open. */
const nameOf = (spiel: FLSpielJoinedAdmin) =>
  spiel.team1 === null || spiel.team2 === null
    ? WORTE.number(spiel.spiel_nr)
    : ROUTES.verwaltungSpiel.title({ record: spiel.team1.name }, { record: spiel.team2.name });

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { spiel } = await readSpiel(params);
  return pageMetadata(parent, ROUTES.verwaltungSpiel, ROUTES.verwaltungSpiel.path(spiel.saison_id, spiel.id), { title: nameOf(spiel) });
}

/** The match editor, on today's match read and write. */
export default function SpielEditorPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

async function readEditor(params: Props["params"]) {
  // Retired venues included, so a match booked at one still names it.
  const [gelesen, { spielorte }] = await Promise.all([readSpiel(params), getSpielorte({ include_inactive: true })]);
  // A finished season's matches take no write (`saison_past`), so the editor opens on one read-only.
  const vorbei = gelesen.saison_status === "past";
  const gespeichert = gelesen.spiel;
  // A retired venue can be booked anew by no match: it is listed only where it is already this match's.
  const gebucht = gespeichert.ort?.spielort_id ?? null;
  const waehlbar = spielorte.filter((ort) => ort.inactive_since === null || ort.id === gebucht);

  // A no-show needs both sides: while one is open, the write refuses it, so it is offered disabled.
  const beideSeiten = gespeichert.team1 !== null && gespeichert.team2 !== null;
  const sonderereignisse: Option[] = [
    { id: KEIN_SONDEREREIGNIS, label: WORTE.none },
    ...Object.values(FLSonderereignis).map((ereignis): Option => {
      const label = SONDEREREIGNISSE[ereignis];
      const offen = !beideSeiten && (ereignis === "nichtantreten_team1" || ereignis === "nichtantreten_team2");
      return offen ? { id: ereignis, label, isDisabled: true, note: WORTE.needsBothSides } : { id: ereignis, label };
    }),
  ];

  return (
    <SpielEditor
      title={nameOf(gespeichert)}
      record={{ id: gespeichert.id, version: gespeichert.version, values: werteOf(gespeichert) }}
      save={spielSpeichern}
      spielorte={waehlbar.map((ort) => ({
        // The match's own retired venue stays in the list, marked and not to be chosen again once left.
        option:
          ort.inactive_since === null
            ? { id: ort.id, label: { record: ort.name } }
            : { id: ort.id, label: { record: ort.name }, isDisabled: true, note: COPY.verwaltung.spielort.retired },
        mietpreis: ort.default_mietpreis,
      }))}
      sonderereignisse={sonderereignisse}
      notizHoechstens={spielePatchSpielBodyNotizOneMax}
      mietpreisPflicht={!SpielePatchSpielBody.shape.ort.options[0].shape.mietpreis.safeParse(null).success}
      spielortAnlegen={spielortAnlegen}
      spielortRegeln={SPIELORT_REGELN}
      {...(vorbei ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
