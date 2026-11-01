// Sevrii's loader: the logo itself, filling with green light while a ring
// turns around it. Used when something loads, when the owner moves between
// sections, and between the start screen and the dashboard.
//   <SevriiLoader />                 inline (inside a panel or a card)
//   <SevriiLoader full label="…" />  over the whole screen
//   <SevriiLoader cover />           over its positioned parent (a section)
export default function SevriiLoader({
  label,
  full = false,
  cover = false,
  size,
  leaving = false,
}: {
  label?: string;
  full?: boolean;
  cover?: boolean;
  size?: number;
  leaving?: boolean;
}) {
  const px = size ?? (full || cover ? 88 : 56);
  const mark = (
    <span className="sevrii-loader" style={{ width: px, height: px }} role="status" aria-live="polite" aria-label={label || "Sevrii"}>
      <span className="sevrii-loader-ring" />
      <span className="sevrii-loader-logo" />
    </span>
  );
  if (!full && !cover) {
    return (
      <span className="inline-flex flex-col items-center gap-3 py-6">
        {mark}
        {label && <span className="text-[13px] text-pmuted">{label}</span>}
      </span>
    );
  }
  return (
    <div className={`sevrii-loader-screen ${full ? "is-full" : "is-cover"} ${leaving ? "is-leaving" : ""}`}>
      {mark}
      {label && <span className="sevrii-loader-label">{label}</span>}
    </div>
  );
}
