import { notFound } from "next/navigation";
import { connection } from "next/server";

import { readAsSeatHolder, requireTeamSeats } from "@/features/funktionen/resolvers";
import { teamHref } from "@/features/funktionen/teamSeats";
import { KaderZeileAusgetragen } from "@/features/spieler/components/forms/KaderZeileEditForm/KaderZeileAusgetragen";
import { KaderZeileEditForm } from "@/features/spieler/components/forms/KaderZeileEditForm/KaderZeileEditForm";
import { kaderName, orderStufen } from "@/features/spieler/constants";
import { getKader } from "@/features/spieler/queries";

import type { FLSpielerRolle } from "@/features/spieler/schemas";
import type { NextPageProps } from "@/shared/types/types";

/**
 * One squad row on its seat holder's panel: its editor while the row is live, and read-only once it
 * is ausgetragen. Read off the squad, whose other rows say who holds each captaincy.
 */
export default async function KaderZeilePage({ params }: NextPageProps<{ team_id: string; saison_id: string; spieler_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  const { team_id, saison_id, spieler_id } = await params;
  const read = await readAsSeatHolder(() => getKader(team_id, saison_id));
  if ("forbidden" in read) return read.forbidden;
  const kader = read.data;

  const zeile = kader.kader.find((candidate) => candidate.spieler_id === spieler_id);
  if (zeile === undefined) notFound();

  const kaderHref = `${teamHref(team_id, saison_id)}/kader`;
  if (zeile.inactive_since !== null) {
    return (
      <KaderZeileAusgetragen
        zeile={{ ...zeile, inactive_since: zeile.inactive_since }}
        kaderHref={kaderHref}
      />
    );
  }

  // Live rows alone, as the write path counts them (`REQ-SQUAD-004`), and never the edited row's own.
  const heldRollen: Partial<Record<FLSpielerRolle, string>> = {};
  for (const other of kader.kader) {
    if (other.spieler_id !== spieler_id && other.inactive_since === null && other.rolle !== null) heldRollen[other.rolle] ??= kaderName(other);
  }

  return (
    // Keyed by the stored row, so the refresh after a write draws the draft anew from what was saved.
    <KaderZeileEditForm
      key={JSON.stringify(zeile)}
      teamId={team_id}
      saisonId={saison_id}
      zeile={zeile}
      erlaubteStufen={orderStufen(kader.erlaubte_stufen)}
      heldRollen={heldRollen}
      kaderHref={kaderHref}
    />
  );
}
