import Link from "next/link";
import Image from "next/image";
import XLogo from "./ThreadsLogo";
import GithubLogo from "./GithubLogo";
import { Suspense } from "react";
import ServerIsLife from "../../ui/ServerIsLife";

export default async function Footer() {
  return (
    <article className="flex flex-col items-center justify-between w-full h-full px-1">
      <aside className="flex flex-row items-center justify-evenly gap-x-6 py-2 text-text-black dark:text-text-white text-fluid-md font-secondary font-semibold">
        <Link
          prefetch={false}
          title="Link to page: about"
          href="/meta/about">
          About
        </Link>
        <Link
          prefetch={false}
          title="Link to page: team"
          href="/meta/team">
          Team
        </Link>
        <Link
          prefetch={false}
          title="Link to page: kontakt"
          href="/meta/kontakt">
          Kontakt
        </Link>
      </aside>
      <aside className="flex flex-row items-center justify-evenly gap-x-12">
        <Link
          prefetch={false}
          title="Link to threads"
          href="https://www.threads.com/@frankfurt.league"
          rel="noopener noreferrer"
          target="_blank">
          <XLogo />
        </Link>
        <Link
          prefetch={false}
          title="Link to github"
          href="https://github.com/felixzabb"
          rel="noopener noreferrer"
          target="_blank">
          <GithubLogo />
        </Link>
        <Link
          prefetch={false}
          title="Link to instagram"
          href="https://www.instagram.com/frankfurt.league/"
          rel="noopener noreferrer"
          target="_blank">
          <Image
            src="/icons/footer/instagram/instagram.svg"
            alt="Instagram logo link"
            width={38}
            height={38}
            title="Instagram by Pixel Icons"
          />
        </Link>
        <Link
          prefetch={false}
          title="Link to whatsapp"
          href="https://whatsapp.com"
          rel="noopener noreferrer"
          target="_blank">
          <Image
            src="/icons/footer/whatsapp/whatsapp.svg"
            alt="Whatsapp logo link"
            width={38}
            height={38}
            title="Whatsapp by Icon Mafia"
          />
        </Link>
      </aside>
      <aside className="flex flex-row items-end justify-between w-full text-fluid-xxs">
        <h3 className="text-left">{`© Frankfurtleague All rights reserved.`}</h3>
        <Suspense fallback={<span className="text-gray-400 opacity-80">Checking...</span>}>
          <ServerIsLife></ServerIsLife>
        </Suspense>
      </aside>
    </article>
  );
}
