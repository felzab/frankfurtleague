"use client";

import { Dialog } from "@/kit/Dialog";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { kaderName } from "@/features/spieler/constants";
import { positionOptions, rolleOptions, stufeOptions } from "@/features/spieler/options";

import { deregisterKaderRow, saveKaderRow } from "./kaderRowActs";

import type { FLKaderRow, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { HeldOpen } from "@/kit/useOpenUntilHidden";

const WORDS = COPY.admin.spieler;

/**
 * A live squad row's dialog, the record titled by the player's name: its four values one under another, Nummer,
 * Position, Stufe and Rolle, as the administration's player editor holds them, and „Austragen“ in its danger row.
 * A role another live row holds stands in its list locked, as the editor's does; the row's own role stays open, so its
 * holder may give it up. Its choices are the editor's own.
 */
export function KaderRowDialog({
  row,
  team,
  saison,
  allowedStufen,
  takenRollen,
  open,
}: {
  row: FLKaderRow;
  team: string;
  saison: string;
  allowedStufen: readonly FLSpielerStufe[];
  /** Each role another live row of the squad holds, the row's own not among them. */
  takenRollen: readonly FLSpielerRolle[];
  open: HeldOpen;
}) {
  const name = kaderName(row);
  const where = { team_id: team, saison_id: saison, spieler_id: row.spieler_id };

  return (
    <Dialog
      title={{ record: name }}
      act={{ verb: "save" }}
      action={saveKaderRow}
      carry={{ ...where, version: String(row.version) }}
      open={open}
      danger={{
        name: COPY.shared.withObject(WORDS.fromKader, "deregister"),
        consequence: WORDS.deregisterConsequence,
        confirm: {
          verb: "deregister",
          subject: COPY.shared.spieler,
          consequence: WORDS.deregisterConsequence,
          facts: [{ label: COPY.shared.name, value: { record: name } }],
          tone: "danger",
          onConfirm: () => deregisterKaderRow(where),
        },
      }}>
      <TextField
        label={WORDS.nummer}
        name="nummer"
        holds={2}
        kind="digits"
        defaultValue={row.nummer ?? ""}
      />
      <Select
        label={WORDS.position}
        name="position"
        options={positionOptions()}
        defaultValue={row.position ?? ""}
      />
      <Select
        label={WORDS.stufe}
        name="stufe"
        options={stufeOptions(allowedStufen, row.stufe)}
        defaultValue={row.stufe ?? ""}
      />
      <Select
        label={WORDS.rolle}
        name="rolle"
        options={rolleOptions(takenRollen)}
        defaultValue={row.rolle ?? ""}
      />
    </Dialog>
  );
}
