/**
 * ADMIN · navigation structure
 *
 * The admin sidemenu, and the icon dictionary it is validated against. Kept in one file precisely so
 * the two cannot disagree.
 */

import { ExclamationShape, Magnifier, MapPin, Person } from "@gravity-ui/icons";

import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * The icon dictionary lives beside the structure it must agree with, and `AdminIconName` is derived
 * from it — so an `iconName` typo below is a compile error instead of a nav item that silently
 * renders without an icon.
 */
export const ADMIN_SIDEMENU_ICONS = {
  ExclamationShape,
  Magnifier,
  Person,
  MapPin,
} as const satisfies Record<string, React.ElementType>;

export type AdminIconName = keyof typeof ADMIN_SIDEMENU_ICONS;

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure<AdminIconName> = [
  {
    category_name: "Spiele",
    sub_options: [
      { id: "action_required", label: "Übersicht", iconName: "ExclamationShape" },
      { id: "spielsuche", label: "Spielsuche", iconName: "Magnifier" },
    ],
  },

  {
    category_name: "Infrastruktur",
    sub_options: [{ id: "spielorte", label: "Spielorte", iconName: "MapPin" }],
  },
  {
    category_name: "Beteiligte",
    sub_options: [{ id: "schiedsrichter", label: "Schiedsrichter", iconName: "Person" }],
  },
];
