import type { SidemenuStructure } from "@/shared/types";

export const DASHBOARD_SIDEMENU_STRUCTURE: SidemenuStructure = [
  {
    category_name: "Spiele",
    sub_options: [
      { id: "spielsuche", label: "Spielsuche" },
      { id: "spielplan", label: "Spielplan" },
      { id: "spielhistorie", label: "Spielhistorie" },
    ],
  },
  {
    category_name: "Tabellen",
    sub_options: [{ id: "saisontabelle", label: "Saisontabelle" }],
  },
  {
    category_name: "Teams",
    sub_options: [{ id: "spieler", label: "Spieler" }],
  },
];
