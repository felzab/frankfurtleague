"use client";

import React from "react";

import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";

import { ADMIN_SIDEMENU_ICONS, ADMIN_SIDEMENU_STRUCTURE } from "../constants";

export default function AdminSidemenu({ saisonMetadataDisplay }: { saisonMetadataDisplay: React.ReactNode }) {
  return (
    <Sidemenu
      structure={ADMIN_SIDEMENU_STRUCTURE}
      linkPrefix="/admin"
      // Only the admin shell sits behind a session, so it is the only one with anything to sign out
      // of (ledger NEW-S1).
      showSignOut
      saisonMetadataDisplay={saisonMetadataDisplay}
      iconDictionary={ADMIN_SIDEMENU_ICONS}
    />
  );
}
