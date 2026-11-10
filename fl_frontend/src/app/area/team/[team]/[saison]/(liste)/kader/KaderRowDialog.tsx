"use client";

import { Dialog } from "@/kit/Dialog";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { FLSpielerPosition } from "@/core/generated/client/types";
import { kaderName, orderStufen } from "@/features/spieler/constants";

import { deregisterKaderRow, saveKaderRow } from "./kaderRowActs";

import type { FLKaderRow, FLSpielerRolle, FLSpielerStufe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { HeldOpen } from "@/kit/useOpenUntilHidden";

const WORDS = COPY.admin.spieler;

/** The first entry of each select: an empty box, which the save reads as no value. */
const NOT_PROVIDED: Option = { id: "", label: COPY.shared.notProvided };

const POSITIONS: readonly Option[] = Object.values(FLSpielerPosition).map((position) => ({ id: position, label: { record: position } }));

const ROLLEN = ["kapitaen", "co_kapitaen"] as const satisfies readonly FLSpielerRolle[];

/**
 * A live squad row's dialog, the record titled by the player's name: its four values one under another, Nummer,
 * Position, Stufe and Rolle, as the administration's player editor holds them, and „Austragen“ in its danger row.
 * A role another live row holds stands in its list locked, as the editor's does; the row's own role stays open, so its
 * holder may give it up.
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
  /** Each role another live row of the squad holds. */
  takenRollen: readonly FLSpielerRolle[];
  open: HeldOpen;
}) {
  const name = kaderName(row);
  const where = { team_id: team, saison_id: saison, spieler_id: row.spieler_id };
  // The season's levels, and a level the row holds that the season stopped offering, which the write still takes.
  const stufen = orderStufen([...allowedStufen, ...(row.stufe === null ? [] : [row.stufe])]).map((stufe): Option => ({
    id: stufe,
    label: COPY.admin.saison.stufe[stufe],
  }));
  const rollen = ROLLEN.map((rolle): Option =>
    takenRollen.includes(rolle) && row.rolle !== rolle
      ? { id: rolle, label: WORDS.rolleOption[rolle], isDisabled: true, note: COPY.shared.field.taken }
      : { id: rolle, label: WORDS.rolleOption[rolle] },
  );

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
        width="short"
        holds={2}
        kind="digits"
        defaultValue={row.nummer ?? ""}
      />
      <Select
        label={WORDS.position}
        name="position"
        options={[NOT_PROVIDED, ...POSITIONS]}
        defaultValue={row.position ?? ""}
      />
      <Select
        label={WORDS.stufe}
        name="stufe"
        options={[NOT_PROVIDED, ...stufen]}
        defaultValue={row.stufe ?? ""}
      />
      <Select
        label={WORDS.rolle}
        name="rolle"
        options={[NOT_PROVIDED, ...rollen]}
        defaultValue={row.rolle ?? ""}
      />
    </Dialog>
  );
}
