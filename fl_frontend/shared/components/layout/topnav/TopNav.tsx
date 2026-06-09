"use server";

import Link from "next/link";
import { Separator } from "@heroui/react";
import { Suspense } from "react";
import TopNavLinksDropdown from "./TopNavLinksDropdown";
import { auth } from "@/core/auth";

export default async function TopNav() {
  const session = await auth();

  return (
    <nav className="flex flex-row justify-between items-center w-full h-full p-2">
      <div className="flex flex-row justify-start items-center min-w-[50%] h-full ">
        <h2>
          <Link
            title="Link to homepage"
            className="pl-2 max-w-[44%] text-fluid-lg font-bold tracking-tighter"
            href="/">
            Frankfurt-League
          </Link>
        </h2>
      </div>

      <div className="flex flex-row items-center justify-end w-fit h-full">
        {/** Shown for everything bigger than mobile */}
        <div className="hidden lg:flex flex-row justify-between items-center gap-x-2 pr-2 w-fit h-full text-text-black dark:text-text-white">
          <Link
            title="Link to page: dashboard"
            className="text-text-black dark:text-text-white text-fluid-sm font-semibold rounded-3xl hover:bg-[#ECECEC] dark:hover:bg-[#26282b] px-2 py-1"
            href="/dashboard">
            Saisonübersicht
          </Link>

          <Link
            title="Link to page: verwalten"
            prefetch={false}
            className="text-text-black dark:text-text-white text-fluid-sm font-semibold rounded-3xl hover:bg-[#ECECEC] dark:hover:bg-[#26282b] px-2 py-1"
            href={!session ? "/signin" : "/admin"}>
            Verwalten
          </Link>

          <Separator
            orientation="vertical"
            className="h-[80%] w-[2px] mt-0.5 bg-text-black dark:bg-text-white"
          />
        </div>

        {/** Shown for mobile */}
        <div className="flex items-center mr-2">
          <Suspense>
            <TopNavLinksDropdown session={session} />
          </Suspense>
        </div>
      </div>
    </nav>
  );
}
