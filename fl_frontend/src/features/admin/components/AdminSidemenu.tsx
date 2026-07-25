"use client";

import React from "react";

import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { ExclamationShape, Magnifier } from "@gravity-ui/icons";

import { ADMIN_SIDEMENU_STRUCTURE } from "../constants";

const iconDictionary: Record<string, React.ElementType> = {
  ExclamationShape: ExclamationShape,
  Magnifier: Magnifier,
};

export default function AdminSidemenu({ saisonMetadataDisplay }: { saisonMetadataDisplay: React.ReactNode }) {
  return (
    <Sidemenu
      structure={ADMIN_SIDEMENU_STRUCTURE}
      linkPrefix="/admin"
      saisonMetadataDisplay={saisonMetadataDisplay}
      iconDictionary={iconDictionary}
    />
  );
}
