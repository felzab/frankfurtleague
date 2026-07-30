"use client";

import React from "react";

import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";

import { ADMIN_SIDEMENU_ICONS, ADMIN_SIDEMENU_STRUCTURE } from "../constants";

export default function AdminSidemenu({ saisonMetadataDisplay }: { saisonMetadataDisplay: React.ReactNode }) {
  return (
    <Sidemenu
      structure={ADMIN_SIDEMENU_STRUCTURE}
      linkPrefix="/admin"
      saisonMetadataDisplay={saisonMetadataDisplay}
      iconDictionary={ADMIN_SIDEMENU_ICONS}
    />
  );
}
