"use client";

import React from "react";

import { DASHBOARD_SIDEMENU_ICONS, DASHBOARD_SIDEMENU_STRUCTURE } from "@/features/dashboard/constants";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";

export default function DashboardSidemenu({ saisonMetadataDisplay }: { saisonMetadataDisplay: React.ReactNode }) {
  return (
    <Sidemenu
      structure={DASHBOARD_SIDEMENU_STRUCTURE}
      linkPrefix="/dashboard"
      saisonMetadataDisplay={saisonMetadataDisplay}
      iconDictionary={DASHBOARD_SIDEMENU_ICONS}
    />
  );
}
