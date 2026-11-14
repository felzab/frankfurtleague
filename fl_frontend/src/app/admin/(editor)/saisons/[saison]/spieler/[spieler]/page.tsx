import { cache } from "react";
import { notFound } from "next/navigation";

import { requires } from "@/core/action";
import { SPIELER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import {
  SpielerPatchSpielerSaisonBody,
  spielerPatchSpielerSaisonBodyFirstNameMax,
  spielerPatchSpielerSaisonBodyLastNameOneMax,
} from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { kaderName } from "@/features/spieler/constants";
import { positionOptions, stufeOptions } from "@/features/spieler/options";
import { getSpielerSaison } from "@/features/spieler/queries";
import { rowState } from "@/features/spieler/rowChip";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { saveSpieler } from "./saveSpieler";
import { deregisterSpieler, reactivateSpieler } from "./spielerActs";
import { SpielerEditor } from "./SpielerEditor";
import { valuesOf } from "./spielerValues";

import type { FLSpielerSaisonAdminResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";
import type { Metadata, ResolvingMetadata, Route } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spieler/[spieler]">;

const WORDS = COPY.admin.spieler;
const { shape } = SpielerPatchSpielerSaisonBody;

/** What the save asks of each of the person's boxes, read off the write's schema. */
const RULES = {
  required: {
    first_name: requires(shape.first_name, ""),
    last_name: requires(shape.last_name, null),
    birth_date: requires(shape.birth_date, null),
  },
  max: { first_name: spielerPatchSpielerSaisonBodyFirstNameMax, last_name: spielerPatchSpielerSaisonBodyLastNameOneMax },
};

/** One read of the player for the tab's title and the page alike. */
const read = cache(getSpielerSaison);

/** The squad row the address names: `null` for a malformed id, and for a person out of that season's squad. */
async function findSpieler(params: Props["params"]) {
  const id = await adminIdParamOf(params, "spieler");
  if (id === null) return null;
  const { saison } = await params;
  const found = await read(id, saison);
  return found === null ? null : { id, saison, found };
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findSpieler(params), ({ id, saison, found }) =>
    pageMetadata(parent, ROUTES.adminSpielerRecord, ROUTES.adminSpielerRecord.path(saison, id), { title: { record: kaderName(found.person) } }),
  );
}

/** A player's editor in one season, on its one read and its one save over the person and their squad row. */
export default async function SpielerEditorPage({ params }: Props) {
  return await readEditor(params);
}

/** The Person box's fact: the address, a mail link to the person. */
function personFacts({ person }: FLSpielerSaisonAdminResponse): Fact[] {
  return [{ label: COPY.signIn.address, link: { href: `mailto:${person.email}` as Route, label: { record: person.email } } }];
}

/** The Kader box's facts: the team, and for an ausgetragen row the day it left. */
function kaderFacts({ kader }: FLSpielerSaisonAdminResponse): Fact[] {
  return [
    { label: COPY.shared.facts.team, value: kader.team_name === null ? COPY.shared.noValue : { record: kader.team_name } },
    ...(kader.inactive_since === null
      ? []
      : [{ label: WORDS.deregisteredOn, value: { record: formatDate(dayOf(kader.inactive_since)) }, figures: true }]),
  ];
}

/** What the person agreed to, in the words they chose it in. */
function einwilligungFacts({ person: { einwilligung } }: FLSpielerSaisonAdminResponse): Fact[] {
  return [
    { label: WORDS.nameOnSite, value: { record: SPIELER_WORDINGS.scope.options[einwilligung.scope] } },
    { label: WORDS.media, value: einwilligung.media ? WORDS.mediaYes : WORDS.mediaNo },
    { label: WORDS.givenOn, value: { record: formatDate(dayOf(einwilligung.date)) }, figures: true },
    { label: WORDS.confirmedOn, value: { record: formatDate(dayOf(einwilligung.confirmed_at)) }, figures: true },
  ];
}

async function readEditor(params: Props["params"]) {
  const located = await findSpieler(params);
  if (located === null) notFound();
  const { id, saison, found } = located;
  const { kader } = found;
  const chip = rowState(kader);

  return (
    <SpielerEditor
      title={{ record: kaderName(found.person) }}
      chip={chip}
      record={{ id, version: found.version, values: valuesOf(found) }}
      saison={saison}
      save={saveSpieler}
      person={personFacts(found)}
      kader={kaderFacts(found)}
      einwilligung={einwilligungFacts(found)}
      rules={RULES}
      positions={positionOptions()}
      stufen={stufeOptions(found.allowed_stufen, kader.stufe)}
      takenRollen={found.taken_rollen}
      danger={
        kader.inactive_since === null
          ? { kind: "deregister", act: deregisterSpieler }
          : {
              kind: "reactivate",
              act: reactivateSpieler,
              // The return brings the row's role back, which `kader_rolle_taken` refuses while another live row holds it.
              ...(kader.rolle !== null && found.taken_rollen.includes(kader.rolle) ? { locked: COPY.shared.field.taken } : {}),
            }
      }
    />
  );
}
