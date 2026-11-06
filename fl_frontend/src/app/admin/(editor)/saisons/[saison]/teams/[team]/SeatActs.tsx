"use client";

import { useTransition } from "react";

import { Button } from "@/kit/Button";
import { Dialog } from "@/kit/Dialog";
import { useLocked } from "@/kit/draftUnsaved";
import { FieldPair } from "@/kit/FieldPair";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { appToast } from "@/kit/Toast";

import { COPY } from "@/core/copy";
import { KONTAKT_ROLLE_LONG_FORM, rollenText } from "@/core/teamVocabulary";

import { sendSeatLink, writeSeat } from "./teamActs";

import type { Copy } from "@/core/copy";
import type { FLKontaktRolle, FLTrainerAlso } from "@/core/generated/client/types";
import type { SeatRules } from "@/features/teams/fieldRules";

const SEAT = COPY.team.seat;
const ACT = { verb: "save" } as const;

/** What a seat's acts read: which seat, whether it waits on an answer, and the person the dialog starts from. */
export type SeatTarget = {
  rolle: FLKontaktRolle;
  /** A person waits on their answer, so a fresh link has someone to reach. */
  asks: boolean;
  person: { first_name: string; last_name: string; email: string; phone: string } | null;
  /** The other seat the Trainer holds, on the Trainer's row alone. */
  trainerAlso: FLTrainerAlso | null;
};

/** The row's acts: a fresh link for a seat waiting on its answer, and „Sitz bearbeiten“, whose dialog replaces the person. */
export function SeatActs({
  target,
  team,
  saison,
  version,
  rules,
  sendLocked,
}: {
  target: SeatTarget;
  team: string;
  saison: string;
  /** The row's own count, which the dialog sends. */
  version: number;
  rules: SeatRules;
  /** Why no link goes: the club left the season. */
  sendLocked?: Copy;
}) {
  const { rolle, asks, person, trainerAlso } = target;
  const key = { team_id: team, saison_id: saison, seat: rolle };
  const [isSending, startSending] = useTransition();
  // A write here raises the row's count, so a draft's save would be turned away as stale: the acts wait for it.
  const unsaved = useLocked(undefined);
  const { required, max } = rules;

  const send = () => {
    startSending(async () => {
      const answer = await sendSeatLink(key);
      appToast(answer.ok ? "success" : "danger", answer.ok ? COPY.shared.toast.linkSent : (answer.reason ?? COPY.shared.toast.failure));
    });
  };

  const edit = (
    <Button
      icon="rename"
      label={COPY.shared.withObject(SEAT, "edit")}
      locked={unsaved}
    />
  );

  return (
    <>
      {asks && (
        <Button
          icon="email"
          label={COPY.shared.withObject(COPY.account.address.link, "send")}
          isBusy={isSending}
          locked={sendLocked ?? unsaved}
          onPress={send}
        />
      )}
      {unsaved !== undefined ? (
        edit
      ) : (
        <Dialog
          title={COPY.shared.withObject(SEAT, "edit")}
          lead={{ record: rollenText([rolle]) }}
          act={ACT}
          action={writeSeat}
          carry={{ team_id: team, saison_id: saison, seat: rolle, version: String(version) }}
          trigger={edit}>
          <FieldPair
            short="both"
            phone="stack">
            <TextField
              label={COPY.shared.firstName}
              name="first_name"
              width="W3"
              kind="text"
              isRequired={required.first_name}
              maxLength={max.first_name}
              defaultValue={person?.first_name}
            />
            <TextField
              label={COPY.shared.lastName}
              name="last_name"
              width="W3"
              kind="text"
              isRequired={required.last_name}
              maxLength={max.last_name}
              defaultValue={person?.last_name}
            />
          </FieldPair>
          <TextField
            label={COPY.signIn.address}
            name="email"
            width="W3"
            kind="email"
            isRequired={required.email}
            maxLength={max.email}
            defaultValue={person?.email}
          />
          <TextField
            label={COPY.shared.facts.phone}
            name="phone"
            width="W3"
            kind="tel"
            isRequired={required.phone}
            defaultValue={person?.phone}
          />
          {rolle === "trainer" && (
            <Select
              label={COPY.team.trainerAlso.label}
              name="trainer_is_also"
              width="fit"
              description={COPY.team.trainerAlso.description}
              options={[
                { id: "", label: COPY.team.trainerAlso.none },
                { id: "ansprechperson", label: { record: KONTAKT_ROLLE_LONG_FORM.ansprechperson } },
                { id: "stellvertretung", label: { record: KONTAKT_ROLLE_LONG_FORM.stellvertretung } },
              ]}
              defaultValue={trainerAlso ?? ""}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
