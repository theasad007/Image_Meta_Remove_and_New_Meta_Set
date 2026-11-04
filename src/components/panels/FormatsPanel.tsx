const ROWS = [
  { ext: "JPG / JPEG", status: "Inspect + clean", note: "EXIF, GPS, XMP, IPTC and comments. Orientation and color data are preserved when needed.", ready: true },
  { ext: "PNG", status: "Inspect + clean", note: "EXIF and text chunks are removed without re-encoding the image.", ready: true },
  { ext: "WebP", status: "Inspect + clean", note: "Still images are supported. Animated WebP is identified and safely refused.", ready: true },
  { ext: "AVIF", status: "Inspect + clean", note: "Supported still-image layouts keep encoded image payloads unchanged.", ready: true },
  { ext: "HEIC / HEIF", status: "Preview + clean", note: "A local decoder provides the preview. Tested still layouts can be cleaned without changing the image payload.", ready: true },
  { ext: "MP4 / MOV / WebM", status: "Preview only", note: "Files may be queued, but video metadata inspection and cleaning are not available yet.", ready: false },
];

export default function FormatsPanel() {
  return (
    <section aria-labelledby="formats-heading" className="py-6">
      <details className="surface-card rounded-2xl p-4">
        <summary className="flex cursor-pointer items-center gap-3">
          <span id="formats-heading" className="font-extrabold text-slate-900">File support</span>
          <span className="text-xs text-slate-500">JPEG · PNG · WebP · AVIF · HEIC</span>
          <span className="ml-auto text-xs font-bold text-blue-700">View details</span>
        </summary>
      <ul className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {ROWS.map((row) => (
          <li key={row.ext} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm font-extrabold text-slate-900">{row.ext}</p>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                {row.status}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{row.note}</p>
          </li>
        ))}
      </ul>
      </details>
    </section>
  );
}
