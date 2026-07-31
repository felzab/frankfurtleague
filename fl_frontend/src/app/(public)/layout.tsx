import ServerIsLive from "@/features/system/components/ServerIsLive";
import Footer from "@/shared/components/layout/footer/Footer";
import TopNav from "@/shared/components/layout/topnav/TopNav";
import { SkipToContentLink } from "@/shared/components/ui/SkipToContentLink";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipToContentLink />

      {/* box-content is load-bearing: the old h-[55px] was 54px of content plus the 1px border
          under border-box, i.e. exactly --navbar-height, which the <nav> inside also uses. Without
          box-content this would be 53px of content and the nav would overflow it by a pixel.
          No Suspense around TopNav, deliberately: it is fully static (sync, no data), so a boundary
          here guards nothing and just adds a resumable slot to the PPR shell. The header, nav and
          links are part of the static shell; the only request-time holes on these routes live in
          the Footer (copyright year, server status) and in the pages' own data sections. */}
      <header className="bg-surface border-border z-10 box-content h-(--navbar-height) w-full border-b">
        <TopNav />
      </header>

      <main
        id="main-content"
        className="flex w-full flex-1 flex-col items-center justify-start">
        {children}
      </main>

      <footer className="bg-surface border-border z-10 h-auto w-full shrink-0 border-t lg:h-[220px]">
        <Footer serverStatusSlot={<ServerIsLive />} />
      </footer>
    </>
  );
}
