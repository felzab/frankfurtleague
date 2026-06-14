export default async function SoccerfieldBg({ children }: { children: React.ReactNode }) {
  return (
    <div className="soccer-field-base dotted-bg">
      {/* Corners */}
      <div className="corner-arc-base corner-arc-tl" />
      <div className="corner-arc-base corner-arc-tr" />
      <div className="corner-arc-base corner-arc-bl" />
      <div className="corner-arc-base corner-arc-br" />

      {/* Penalty areas */}
      <div className="penalty-area-base penalty-area-top" />
      <div className="penalty-area-base penalty-area-bottom" />

      {children}
    </div>
  );
}
