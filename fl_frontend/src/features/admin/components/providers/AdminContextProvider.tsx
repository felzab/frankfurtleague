"use client";

import { createContext, useContext, ReactNode } from "react";
import type { AdminContext } from "../../types";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLTeam } from "@/features/teams/schemas";

const AdminContext = createContext<AdminContext | undefined>(undefined);

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
