"use client";

import type { FLSpiel } from "../../schemas";
import SpielCardsList from "../collections/SpielCardsList";

export default function SpielhistorieView({ spielhistorieData }: { spielhistorieData: FLSpiel[] }) {
  return (
    <div className="w-full flex flex-col items-center lg:mt-2 px-2 pb-20 overflow-y-scroll scrollbar-hide">
      <SpielCardsList spiele={spielhistorieData} />
    </div>
  );
}
