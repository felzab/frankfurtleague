"use client";

import { usePathname } from "next/navigation";

import ArrowRightArrowLeft from "@gravity-ui/icons/ArrowRightArrowLeft";
import ArrowUturnCwLeft from "@gravity-ui/icons/ArrowUturnCwLeft";
import ChevronsExpandVertical from "@gravity-ui/icons/ChevronsExpandVertical";

import { Dropdown } from "@heroui/react/dropdown";
import { Separator } from "@heroui/react/separator";

import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";

import { IconTooltip } from "../../ui/IconTooltip";
import { NAME_WRAP_CLASSES } from "../../ui/nameWrap";
import { RAIL_SQUARE_HEROUI_RING_CLASSES } from "./railGutter";
import { useSidemenuState } from "./SidemenuState";

/** One place a person's Funktionen lead to, labelled as the landing labels its card for it. */
export type FunktionOrt = { href: string; titel: string; detail: string };

const BEREICH_HREF = "/bereich";

/**
 * The place the address stands in, every page below a place's own being that place's. Matched by whole
 * segments, so `/bereich/spielerin` stands in no place `/bereich/spieler` names; no two places nest.
 */
function ortAt(orte: readonly FunktionOrt[], pathname: string): FunktionOrt | undefined {
  return orte.find((ort) => pathname === ort.href || pathname.startsWith(`${ort.href}/`));
}

/**
 * The switch between the places a person's Funktionen lead to, at the head of every signed-in shell's
 * sidemenu. Absent below two places: one is no choice, and a press would land where it started.
 */
export function FunktionSwitcher({
  orte,
  ohneOrt,
  mitBereich,
}: {
  orte: readonly FunktionOrt[];
  /** What the trigger names where the address is none of the places, the person area's own pages among them. */
  ohneOrt: string;
  /** The way to `/bereich` beneath the places, which a shell whose own landing is `/bereich` leaves out. */
  mitBereich: boolean;
}) {
  const pathname = usePathname() ?? "";
  const { isDesktopCollapsed, onMobileClose } = useSidemenuState();
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  if (orte.length < 2) return null;

  const aktuell = ortAt(orte, pathname);
  const titel = aktuell?.titel ?? ohneOrt;

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}>
      <IconTooltip
        label="Funktion wechseln"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        {/* The options row's own shape, so the rail's two menus read as one kind of control; expanded, its height
            is a floor, as a club's name wraps rather than hiding the words that tell two clubs apart. */}
        <Dropdown.Trigger
          aria-label={isDesktopCollapsed ? "Funktion wechseln" : `${titel}, Funktion wechseln`}
          className={`flex shrink-0 items-center rounded-md text-foreground transition-colors data-hovered:bg-hover data-[pressed=true]:transform-none ${
            isDesktopCollapsed
              ? `h-9 w-9 justify-center p-0 ${RAIL_SQUARE_HEROUI_RING_CLASSES}`
              : "min-h-9 w-full justify-start gap-2 px-3 py-1.5"
          }`}>
          {isDesktopCollapsed ? (
            <ArrowRightArrowLeft
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
          ) : (
            <>
              <span className={`min-w-0 flex-1 text-start fluid-sm font-semibold ${NAME_WRAP_CLASSES}`}>{titel}</span>
              <ChevronsExpandVertical
                aria-hidden="true"
                className="size-4.5 shrink-0 text-foreground-muted"
              />
            </>
          )}
        </Dropdown.Trigger>
      </IconTooltip>

      <Dropdown.Popover
        offset={8}
        placement={isDesktopCollapsed ? "right top" : "bottom"}
        // The options menu's widths, so the two menus of one rail open alike.
        className={`min-w-[250px] rounded-xl ${isDesktopCollapsed ? "w-[220px]" : "w-[calc(100vw-2rem)] lg:w-(--trigger-width)"}`}>
        <Dropdown.Menu
          aria-label="Deine Funktionen"
          selectionMode="single"
          selectedKeys={aktuell === undefined ? [] : [aktuell.href]}>
          <Dropdown.Section aria-label="Deine Funktionen">
            {orte.map((ort) => (
              <Dropdown.Item
                key={ort.href}
                id={ort.href}
                href={ort.href}
                textValue={ort.titel}
                // Each press leaves the shell, so it closes the drawer itself, for `SidemenuFooter`'s reason.
                onAction={onMobileClose}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5">
                <Dropdown.ItemIndicator />
                <span className="flex min-w-0 flex-col">
                  <span className={`fluid-sm font-semibold text-foreground ${NAME_WRAP_CLASSES}`}>{ort.titel}</span>
                  <span className="muted-hint">{ort.detail}</span>
                </span>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>

          {mitBereich && (
            <>
              <Separator className="my-1" />
              <Dropdown.Section aria-label="Zu Deinem Bereich">
                <Dropdown.Item
                  id={BEREICH_HREF}
                  href={BEREICH_HREF}
                  textValue="Zu Deinem Bereich"
                  onAction={onMobileClose}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5">
                  <ArrowUturnCwLeft
                    aria-hidden="true"
                    className="size-4 shrink-0 text-foreground-muted"
                  />
                  <span className="fluid-sm font-semibold text-foreground">Zu Deinem Bereich</span>
                </Dropdown.Item>
              </Dropdown.Section>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
