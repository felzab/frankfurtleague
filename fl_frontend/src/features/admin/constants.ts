import type { SidemenuStructure } from "@/shared/types/types";

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure = [
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

export const TBD_TEAM_SHORTHAND = "??";
