"use client";

import React from "react";

import { DASHBOARD_SIDEMENU_STRUCTURE } from "@/features/dashboard/constants";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { Calendar, ClockArrowRotateLeft, LayoutHeaderCells, Magnifier, Medal, Person, Persons } from "@gravity-ui/icons";

const iconDictionary: Record<string, React.ElementType> = {
  Magnifier: Magnifier,
  ClockArrowRotateLeft: ClockArrowRotateLeft,
  Calendar: Calendar,
  Medal: Medal,
  LayoutHeaderCells: LayoutHeaderCells,
  Persons: Persons,
  Person: Person,
};

export default function DashboardSidemenu({ saisonMetadataDisplay }: { saisonMetadataDisplay: React.ReactNode }) {
  return (
    <Sidemenu
      structure={DASHBOARD_SIDEMENU_STRUCTURE}
      linkPrefix="/dashboard"
      saisonMetadataDisplay={saisonMetadataDisplay}
      iconDictionary={iconDictionary}
    />
  );
}
