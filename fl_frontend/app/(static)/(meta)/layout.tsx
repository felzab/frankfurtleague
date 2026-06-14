import SoccerfieldBg from "@/shared/components/layout/SoccerfieldBg";

export default async function MetaLayout({ children }: { children: React.ReactNode }) {
  return <SoccerfieldBg>{children}</SoccerfieldBg>;
}
