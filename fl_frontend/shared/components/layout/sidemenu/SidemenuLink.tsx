import Link from "next/link";

export default function SidemenuLink({
  itemId,
  itemLabel,
  isActive,
  toggleSidemenu,
  linkPrefix,
}: {
  itemId: string;
  itemLabel: string;
  isActive: boolean;
  toggleSidemenu: () => void;
  linkPrefix: string;
}) {
  return (
    <Link
      title={`Link to subpage: ${itemId}`}
      onClick={toggleSidemenu}
      key={itemId}
      className={` flex items-center justify-center w-full h-[36px] sm:h-[42px] lg:h-[48px] lg:px-2 rounded-[36px] text-text-black dark:text-text-white text-center text-fluid-base lg:text-fluid-sm tracking-wide font-secondary font-semibold  ${
        isActive ? "bg-quaternary-light dark:bg-quaternary-dark  " : "bg-tertiary-light dark:bg-tertiary-dark"
      }`}
      href={`/${linkPrefix}/${itemId}#top`}>
      {itemLabel /* Option name */}
    </Link>
  );
}
