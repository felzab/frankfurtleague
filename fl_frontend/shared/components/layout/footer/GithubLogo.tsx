"use client";

import useMounted from "@/shared/hooks/useMounted";
import { useTheme } from "next-themes";
import Image from "next/image";

export default function GithubLogo() {
  const { theme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return <></>;
  }

  return (
    <Image
      src={theme === "light" ? "/icons/footer/github/github_logo_black.svg" : "/icons/footer/github/github_logo_white.svg"}
      alt="Github logo link"
      width={38}
      height={38}
      title="Github logo link"
      className="w-[38px] h-[38px]"
    />
  );
}
