"use client";

import SpielCardsList from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

export default function SpielhistorieView({ spielhistorieData }: { spielhistorieData: FLSpiel[] }) {
  return (
    <div className="scrollbar-hide flex w-full flex-col items-center overflow-y-scroll px-2 pb-20 lg:mt-2">
      <SpielCardsList spiele={spielhistorieData} />
    </div>
  );
}
