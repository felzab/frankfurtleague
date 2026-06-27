import dynamic from "next/dynamic";
import Link from "next/link";

import { Bars } from "@gravity-ui/icons";

const TopNavLinksDropdown = dynamic(() => import("./TopNavLinksDropdown"), {
  ssr: true,
  loading: () => (
    <Bars
      aria-label="Loading menu"
      height={32}
      width={32}
      className="opacity-50"
    />
  ),
});

export default async function TopNav() {
  return (
    <nav className="flex h-full w-full flex-row items-center justify-between p-2">
      <div className="flex h-full min-w-[50%] flex-row items-center justify-start">
        <h2>
          <Link
            prefetch={false}
            title="Link to homepage"
            className="text-fluid-lg max-w-[44%] pl-2 font-bold tracking-tighter"
            href="/">
            Frankfurt-League
          </Link>
        </h2>
      </div>

      <div className="flex h-full w-fit flex-row items-center justify-end">
        {/** Shown for everything bigger than mobile */}
        <div className="text-text-black dark:text-text-white hidden h-full w-fit flex-row items-center justify-between gap-x-2 pr-2 lg:flex">
          <Link
            prefetch={false}
            title="Link to page: dashboard"
            className="text-text-black dark:text-text-white text-fluid-sm rounded-3xl px-2 py-1 font-semibold hover:bg-[#ECECEC] dark:hover:bg-[#26282b]"
            href="/dashboard">
            Saisonübersicht
          </Link>

          <Link
            title="Link to page: verwalten"
            prefetch={false}
            className="text-text-black dark:text-text-white text-fluid-sm rounded-3xl px-2 py-1 font-semibold hover:bg-[#ECECEC] dark:hover:bg-[#26282b]"
            href="/admin">
            Verwalten
          </Link>

          <div className="bg-text-black dark:bg-text-white h-full w-[2px]" />
        </div>

        <div className="mr-2 flex items-center">
          <TopNavLinksDropdown />
        </div>
      </div>
    </nav>
  );
}
