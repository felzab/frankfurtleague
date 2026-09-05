// The page box for the whole group: the width and the padding a meta page wears live here, so no
// view under it spells either.
export default function MetaLayout({ children }: { children: React.ReactNode }) {
  return <div className="max-w-meta w-full px-3 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8">{children}</div>;
}
