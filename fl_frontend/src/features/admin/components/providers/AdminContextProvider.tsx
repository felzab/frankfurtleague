"use client";

import { createContext, useContext, useMemo } from "react";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLTeam } from "@/features/teams/schemas";
import type { ReactNode } from "react";
import type { AdminContext } from "../../types";

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
  saisonSpiele,
  children,
}: {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
  saisonSpiele: FLSpiel[];
  children: ReactNode;
}) {
  // Memoised by hand because the React Compiler is deliberately off (ADR-0014). A fresh object
  // literal here is a new identity every render, re-rendering every `useAdmin()` consumer whenever
  // only `children` changed.
  const value = useMemo(() => ({ spielorte, schiedsrichter, teams, saisonSpiele }), [spielorte, schiedsrichter, teams, saisonSpiele]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
