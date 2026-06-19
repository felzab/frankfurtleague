"use client";

import { createContext, useContext, ReactNode } from "react";
import type { FLTeam } from "@/features/teams/types";
import { FLSpielort } from "@/features/spielorte/types";
import { FLSchiedsrichter } from "@/features/schiedsrichter/types";

const AdminContext = createContext<
  | {
      spielorte: FLSpielort[];
      schiedsrichter: FLSchiedsrichter[];
      teams: FLTeam[];
    }
  | undefined
>(undefined);

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error("useAdmin must be used within a AdminProvider");
  }
  return context;
}

export function AdminProvider({
  spielorte,
  schiedsrichter,
  teams,
  children,
}: {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
  children: ReactNode;
}) {
  return (
    <AdminContext.Provider value={{ spielorte: spielorte, schiedsrichter: schiedsrichter, teams: teams }}>{children}</AdminContext.Provider>
  );
}
