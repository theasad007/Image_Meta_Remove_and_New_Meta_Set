"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { QueueEntry } from "../../types/media";

/**
 * Shared queue previews — one implementation for the Screen 04 row
 * thumbnails and the Screen 05/06 dialogs. Nothing decodes eagerly:
 * object URLs exist only while the component is mounted and are always
 * revoked, and HEIC/HEIF decodes lazily only after the browser's native
 * decode attempt fails.
 */

/**
 * Preview source hook: one object URL per entry, shared between dialog
 * thumbnails and the large contained preview. Every format is probed once;
 * a failed native decode falls back to the same lazy local HEIC/HEIF
 * decoder used by the Screen 04 thumbnails, and anything still undecodable
 * reports an honest "unavailable" status. The URL is always revoked on
 * change/unmount, and per-file state is reset when the dialog navigates so
 * preview bytes never leak between files.
 */
export function useEntryPreview(entry: QueueEntry | undefined): {
  url: string | null;
  status: "loading" | "ready" | "failed";
} {
  const [state, setState] = useState<{ entryId: string | null; url: string | null; status: "loading" | "ready" | "failed" }>({
    entryId: null,
    url: null,
    status: "loading",
  });

  const entryId = entry?.item.id ?? null;
  // Render-derived reset: whenever the dialog targets a different file the
  // preview state drops to "loading" for it — stale bytes/URLs/decodes from
  // the previous file can never bleed into the new one.
  if (state.entryId !== entryId) {
    const decodableImage = entry !== undefined && entry.item.detected.mediaKind === "image";
    setState({
      entryId,
      url: null,
      status: decodableImage ? "loading" : "failed",
    });
  }

  useEffect(() => {
    if (!entry || entry.item.detected.mediaKind !== "image") return;
    const id = entry.item.id;
    let active = true;
    let created = URL.createObjectURL(entry.source);

    const attachDecoded = async () => {
      try {
        const decoded = await import("heic-to/csp").then(({ heicTo }) =>
          heicTo({ blob: entry.source, type: "image/jpeg", quality: 0.82 }),
        );
        if (!active) {
          URL.revokeObjectURL(created);
          return;
        }
        URL.revokeObjectURL(created);
        created = URL.createObjectURL(decoded);
        setState({ entryId: id, url: created, status: "ready" });
      } catch {
        if (active) {
          setState({ entryId: id, url: null, status: "failed" });
        }
      }
    };

    const probe = new window.Image();
    // src MUST be assigned before decode(); an empty-src decode() promise
    // rejects immediately and would misreport valid images as undecodable.
    probe.src = created;
    probe
      .decode()
      .then(() => {
        if (!active) {
          URL.revokeObjectURL(created);
          return;
        }
        setState({ entryId: id, url: created, status: "ready" });
      })
      .catch(() => {
        if (!active) {
          URL.revokeObjectURL(created);
          return;
        }
        const extension = entry.item.detected.extension.toLowerCase();
        const brand = entry.item.detected.brand?.toLowerCase() ?? "";
        const heicLike = extension === "heic" || extension === "heif" || brand.startsWith("hei")
          || entry.source.type === "image/heic" || entry.source.type === "image/heif";
        if (heicLike) void attachDecoded();
        else {
          URL.revokeObjectURL(created);
          setState({ entryId: id, url: null, status: "failed" });
        }
      });

    return () => {
      active = false;
      URL.revokeObjectURL(created);
    };
  }, [entry]);

  // During render the "current" view can only be the freshly reset state —
  // it is keyed by entry id, so nothing ever leaks across files.
  return { url: state.url, status: state.status };
}

/** Preview failure notice rendered inside a preview card (honest fallback). */
export function PreviewFallback({ heicHint, spinning }: { heicHint: boolean; spinning: boolean }): ReactNode {
  if (spinning) {
    return <span aria-hidden="true" className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 motion-reduce:animate-none" />;
  }
  return (
    <span className="flex max-w-[16rem] flex-col items-center gap-2 px-4 text-center" role="img" aria-label="Image preview unavailable">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-slate-400" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="m5.5 17 4.2-4.2 3.1 3.1 2.1-2.1 3.6 3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-[11.5px] font-semibold leading-4 text-slate-500">
        {heicHint ? "Image preview unavailable — this HEIC/HEIF preview could not be decoded locally." : "Image preview unavailable for this file."}
      </p>
    </span>
  );
}

export function PhotoPlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <span className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400" aria-label={loading ? "Loading image preview" : "Image preview unavailable"}>
      {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 motion-reduce:animate-none" /> : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none">
          <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="m5.5 17 4.2-4.2 3.1 3.1 2.1-2.1 3.6 3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export function ObjectUrlImage({
  blob,
  alt,
  onBroken,
  fit = "cover",
}: {
  blob: Blob;
  alt: string;
  onBroken?: () => void;
  /** "cover" crops thumbnails; "contain" letterboxes the details-dialog preview. */
  fit?: "cover" | "contain";
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className={fit === "contain" ? "h-full w-full object-contain" : "h-full w-full object-cover"} onError={onBroken} />
  ) : <PhotoPlaceholder loading />;
}

export function ObjectUrlVideo({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <video src={url} aria-label={label} muted playsInline controls preload="metadata" className="h-full w-full object-cover" /> : <PhotoPlaceholder loading />;
}

/** Phase 07: local MP3 playback preview — object URL only, never uploaded,
 *  never transcoded; auto-revoked when the row unmounts. No autoplay. */
export function ObjectUrlAudio({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return <PhotoPlaceholder loading />;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#eef2fb] p-3" data-testid="audio-preview">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 text-[#2d5be9]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V6l10-2v12" />
        <circle cx="6.5" cy="18.5" r="2.6" />
        <circle cx="16.5" cy="16" r="2.6" />
      </svg>
      <audio src={url} controls preload="metadata" aria-label={label} className="w-full max-w-[16rem]" data-testid="audio-player" />
    </div>
  );
}

export function HeicPreview({ source, alt, fit = "cover" }: { source: File; alt: string; fit?: "cover" | "contain" }) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const [decoded, setDecoded] = useState<Blob | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);

  useEffect(() => {
    if (!nativeFailed) return;
    let active = true;
    void import("heic-to/csp")
      .then(({ heicTo }) => heicTo({ blob: source, type: "image/jpeg", quality: 0.82 }))
      .then((preview) => {
        if (active) setDecoded(preview);
      })
      .catch(() => {
        if (active) setDecodeFailed(true);
      });
    return () => {
      active = false;
    };
  }, [nativeFailed, source]);

  if (decoded) return <ObjectUrlImage blob={decoded} alt={alt} fit={fit} />;
  if (decodeFailed) return <PhotoPlaceholder />;
  if (nativeFailed) return <PhotoPlaceholder loading />;
  return <ObjectUrlImage blob={source} alt={alt} fit={fit} onBroken={() => setNativeFailed(true)} />;
}

export function Preview({ entry, enabled, detailed = false, fit = "cover" }: { entry: QueueEntry; enabled: boolean; detailed?: boolean; fit?: "cover" | "contain" }) {
  if (!enabled) return <PhotoPlaceholder />;
  const extension = entry.item.detected.extension.toLowerCase();
  const brand = entry.item.detected.brand?.toLowerCase() ?? "";
  const heic = extension === "heic" || extension === "heif" || brand.startsWith("hei");
  const label = detailed ? `${entry.item.name} expanded preview` : `${entry.item.name} thumbnail`;
  if (heic) return <HeicPreview source={entry.source} alt={label} fit={fit} />;
  if (entry.item.detected.mediaKind === "video") return <ObjectUrlVideo blob={entry.source} label={`${entry.item.name} video preview`} />;
  if (entry.item.detected.mediaKind === "audio") return <ObjectUrlAudio blob={entry.source} label={`${entry.item.name} audio preview`} />;
  if (entry.item.detected.mediaKind !== "image") return <PhotoPlaceholder />;
  return <ObjectUrlImage blob={entry.source} alt={label} fit={fit} />;
}
