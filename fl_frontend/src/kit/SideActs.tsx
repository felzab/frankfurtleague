"use client";

import { createContext, use } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { actsFold } from "./cardStyles";
import { Menu } from "./Menu";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";
import type { MenuEntry } from "./Menu";

/**
 * The stacking width of the box a row's acts stand in, a list's (`Table`'s `folds`) or a card's rows' (`SeatRows`), or
 * `null` where the box folds no acts.
 */
type Fold = "list" | "crowded" | "card" | null;

const ActsFold = createContext<Fold>(null);

/**
 * What a list hands its rows' acts: whether its rows' side acts fold, and at which stacking width. A client part, since
 * the list is drawn on the server, where no context is given.
 */
export function ActsFoldScope({ at, children }: { at: Fold; children: ReactNode }) {
  return <ActsFold value={at}>{children}</ActsFold>;
}

/** One side act of a row: its words, its button's and its menu entry's alike, and what its press does. */
export type SideAct = {
  label: Copy;
  /** An icon alone as the act's button, named by `label`, as a seat's acts are; the menu's entry shows both. */
  icon?: IconName;
  /**
   * An act that destroys: its button in the outlined danger look every destroying act's trigger takes, and its menu
   * entry in the same danger hue (`Menu`'s `tone`), while it can run; a locked one is muted as every locked entry is.
   */
  tone?: "danger";
  /** The act is under way: its button busy, and the „⋯“ that holds it. */
  isBusy?: boolean;
  /**
   * Why the act cannot run on the record as it stands: its button dimmed, reachable and saying why (`Button`'s
   * `locked`), and its menu entry the same (`Menu`'s locked entry); `onPress` is never called.
   */
  locked?: Copy;
  /**
   * Runs the act, or opens its question or its dialog. A press on the menu's entry calls it as a press on the button
   * does, in the press's own event, so an act behind the passkey touch asks it from that press.
   */
  onPress: () => void;
};

const entryOf = ({ label, icon, tone, locked, onPress }: SideAct): MenuEntry =>
  locked === undefined
    ? { kind: "action", label, ...(icon === undefined ? {} : { icon }), ...(tone === undefined ? {} : { tone }), onAction: onPress }
    : { kind: "locked", label, ...(icon === undefined ? {} : { icon }), reason: locked };

function ActButton({ label, icon, tone, isBusy, locked, onPress }: SideAct) {
  const press = { label, isBusy, locked, onPress };
  return icon === undefined ? (
    <Button
      variant={askingLook(tone ?? "primary")}
      {...press}
    />
  ) : (
    <Button
      icon={icon}
      {...press}
    />
  );
}

/**
 * A row's side acts, the ones beside what the row is for, such as a running change's fresh link and its ending or a
 * seat's link and its edit: in a box that folds them (`Table`'s `folds`, `SeatRows`) they are buttons at the row's end
 * where the box is wide, and one „⋯“ at the row's end where its rows are stacked, which opens the kit's menu on the
 * same acts in the same order, a destroying one after the others. Every row of such a box folds, one holding a single
 * act too, so its rows stand alike. A row's decision, such as „Zusagen“ and „Ablehnen“, is no side act and is never
 * folded.
 *
 * `children` are the questions and dialogs the acts open, each on the open state its act's press sets: one opened from
 * the menu hands the focus back to the „⋯“ as it closes, as the menu itself does.
 */
export function SideActs({ acts, children }: { acts: ReadonlyArray<SideAct>; children?: ReactNode }) {
  const at = use(ActsFold);
  const buttons = acts.map((act) => (
    <ActButton
      key={act.label}
      {...act}
    />
  ));
  if (at === null)
    return (
      <>
        {buttons}
        {children}
      </>
    );
  const s = actsFold({ at });
  return (
    <>
      <span className={s.buttons()}>{buttons}</span>
      <span className={s.menu()}>
        <Menu
          label={COPY.template.more}
          placement="below"
          trigger={
            <Button
              icon="more"
              label={COPY.template.more}
              isBusy={acts.some((act) => act.isBusy === true)}
            />
          }
          groups={[acts.map(entryOf)]}
        />
      </span>
      {children}
    </>
  );
}
