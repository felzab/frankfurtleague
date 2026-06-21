export default function PageLoader() {
  return (
    <div className="flex h-[200dvh] flex-col items-center justify-start pt-20 text-center">
      <div className="border-quaternary-light dark:border-quaternary-dark h-25 w-25 animate-spin rounded-full border-8 border-dotted"></div>
      <h2 className="text-text-black dark:text-text-white mt-4">Laden...</h2>
    </div>
  );
}
