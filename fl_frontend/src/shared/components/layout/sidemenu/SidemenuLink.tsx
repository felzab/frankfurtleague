import Link from "next/link";

export default function SidemenuLink({
  itemId,
  itemLabel,
  isActive,
  toggleSidemenu,
  href,
}: {
  itemId: string;
  itemLabel: string;
  isActive: boolean;
  toggleSidemenu: () => void;
  href: string;
}) {
  return (
    <Link
      title={`Link to subpage: ${itemId}`}
      onClick={toggleSidemenu}
      key={itemId}
      className={`text-text-black dark:text-text-white text-fluid-base lg:text-fluid-sm font-secondary flex h-[36px] w-full items-center justify-center rounded-[36px] text-center font-semibold tracking-wide sm:h-[42px] lg:h-[48px] lg:px-2 ${
        isActive ? "bg-quaternary-light dark:bg-quaternary-dark" : "bg-tertiary-light dark:bg-tertiary-dark"
      }`}
      href={href + "#top"}>
      {itemLabel /* Option name */}
    </Link>
  );
}
