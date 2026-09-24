"use client";

import { useState } from "react";

import ArrowRightFromSquare from "@gravity-ui/icons/ArrowRightFromSquare";
import Ellipsis from "@gravity-ui/icons/Ellipsis";
import Key from "@gravity-ui/icons/Key";

import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Separator } from "@heroui/react/separator";

import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";
import { useSignOut } from "@/shared/hooks/useSignOut";

import { IconTooltip } from "../../ui/IconTooltip";
import { ThemeSwitch } from "../../ui/ThemeSwitch";
import { RAIL_SQUARE_HEROUI_RING } from "./railGutter";

import type { FormState } from "@/shared/types/types";

/**
 * A second placement of the bar's two controls; the behaviour is shared through `useSignOut`, the appearance is not.
 * `Dropdown.Trigger` renders the button itself, so a `<button>` nested inside would swallow the press.
 */
export function SidemenuOptionsMenu({
  isDesktopCollapsed,
  onSignOut,
  onManagePasskeys,
}: {
  isDesktopCollapsed: boolean;
  /** Injected by the shell that has a session to end, and its presence is the gate — `shared` cannot import from `features`. */
  onSignOut?: () => Promise<FormState>;
  /** Injected the same way, and gated on its own presence: the dialog it opens is the shell's to render. */
  onManagePasskeys?: () => void;
}) {
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}>
      <IconTooltip
        label="Weitere Optionen"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        {/* `transform-none` cancels HeroUI's `.dropdown__trigger` press, which reads wrong on a full-width row.
            `scale-100` would not work: v4's standalone `scale` composes with `transform` rather than replacing it. */}
        <Dropdown.Trigger
          aria-label="Weitere Optionen"
          className={`text-foreground-muted data-hovered:bg-hover data-hovered:text-foreground flex h-9 shrink-0 items-center rounded-md transition-colors data-[pressed=true]:transform-none ${
            isDesktopCollapsed ? `w-9 justify-center p-0 ${RAIL_SQUARE_HEROUI_RING}` : "w-full justify-start gap-2 px-3"
          }`}>
          <Ellipsis
            aria-hidden="true"
            className="size-4.5 shrink-0"
          />
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Optionen</span>}
        </Dropdown.Trigger>
      </IconTooltip>

      {/* `offset` rather than a margin class: it feeds react-aria's positioning maths, so the gap is measured from
          the trigger in whichever direction the menu ends up opening. */}
      <Dropdown.Popover
        offset={8}
        placement={isDesktopCollapsed ? "right bottom" : "top"}
        /* Portalled, so overhanging the drawer costs nothing. From `lg` it takes the row's width: the footer reserves
           a scrollbar's strip no stylesheet can measure, so a width derived from the rail's overhangs the row. */
        className={`min-w-[250px] rounded-xl ${isDesktopCollapsed ? "w-[220px]" : "w-[calc(100vw-2rem)] lg:w-(--trigger-width)"}`}>
        <Dropdown.Menu aria-label="Seitenmenü-Optionen">
          <Dropdown.Section aria-label="Einstellungen">
            {/* A container for a control rather than a command, so pressing it must not dismiss the menu.
                `bg-transparent!` with no state variant: cancelling one attribute leaves the next one tinting. */}
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              shouldCloseOnSelect={false}
              className="flex w-full cursor-default items-center justify-between bg-transparent! px-2 py-1.5">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Modus</Label>
              <ThemeSwitch compact />
            </Dropdown.Item>
          </Dropdown.Section>

          {onSignOut && (
            <>
              <Separator className="my-1" />
              <Dropdown.Section aria-label="Konto">
                {onManagePasskeys && (
                  /* Closes on select, unlike the two items above it: the dialog it opens is rendered
                     outside this `Dropdown.Popover`, which portals and unmounts on close. */
                  <Dropdown.Item
                    id="passkeys"
                    textValue="Passkeys verwalten"
                    onAction={onManagePasskeys}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
                    <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Passkeys verwalten</Label>
                    <Key
                      aria-hidden="true"
                      className="text-foreground-muted size-4 shrink-0"
                    />
                  </Dropdown.Item>
                )}
                <SignOutItem
                  onSignOut={onSignOut}
                  isMenuOpen={isOpen}
                />
              </Dropdown.Section>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * Its own component only so the hook lives beside the state that resets it: arming is per-visit, and a menu reopened
 * later must not still be one press away from ending the session.
 */
function SignOutItem({ onSignOut, isMenuOpen }: { onSignOut: () => Promise<FormState>; isMenuOpen: boolean }) {
  const { isConfirming, isSigningOut, press, disarm } = useSignOut(onSignOut);
  const [wasOpen, setWasOpen] = useState(isMenuOpen);

  // Adjusted during render rather than through `onOpenChange`, which would miss one direction:
  // `useNavigationClosedOverlay` closes the menu on a route change by setting its own state.
  if (isMenuOpen !== wasOpen) {
    setWasOpen(isMenuOpen);
    disarm();
  }

  return (
    <Dropdown.Item
      id="sign-out"
      textValue={isConfirming ? "Abmelden?" : "Abmelden"}
      data-signout-control="true"
      isDisabled={isSigningOut}
      /* Without this the first press dismisses the menu and the second never happens. */
      shouldCloseOnSelect={false}
      onAction={press}
      /* One red at rest and one when armed, with no hover step to compete with the state that matters. The `!`
         is what beats an unlayered muted fill in `globals.css`. */
      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
        isConfirming ? "bg-danger/15!" : "bg-danger/10!"
      }`}>
      {/* Armed, the row is its question alone. The tint and the label both shift, so the state never rests on colour. */}
      <Label className={`fluid-sm text-danger-strong min-w-0 flex-1 font-semibold ${isConfirming ? "text-center" : ""}`}>
        {isSigningOut ? "Meldet ab..." : isConfirming ? "Abmelden?" : "Abmelden"}
      </Label>
      {!isConfirming && (
        <ArrowRightFromSquare
          aria-hidden="true"
          className="text-danger-strong size-4 shrink-0"
        />
      )}
    </Dropdown.Item>
  );
}
