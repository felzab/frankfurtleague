export default async function TeamsSpielerSharedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex w-full flex-1 flex-col items-center p-6">
      <div className="w-full max-w-page">{children}</div>
    </div>
  );
}
