import { Suspense } from "react";

import ServerIsLive from "@/features/system/components/ServerIsLive";
import Footer from "@/shared/components/layout/footer/Footer";
import TopNav from "@/shared/components/layout/topnav/TopNav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* box-content is load-bearing: the old h-[55px] was 54px of content plus the 1px border
          under border-box, i.e. exactly --navbar-height, which the <nav> inside also uses. Without
          box-content this would be 53px of content and the nav would overflow it by a pixel. */}
      <header className="bg-surface border-border z-10 h-(--navbar-height) w-full border-b box-content">
        {/* Sized to the header, not the page: this boundary wraps TopNav, not children. */}
        <Suspense fallback={<div className="bg-muted/40 h-full w-full animate-pulse" />}>
          <TopNav />
        </Suspense>
      </header>

      <main className="flex w-full flex-1 flex-col items-center justify-start">{children}</main>

      <footer className="bg-surface border-border z-10 h-auto w-full shrink-0 border-t lg:h-[220px]">
        <Footer serverStatusSlot={<ServerIsLive />} />
      </footer>
    </>
  );
}
