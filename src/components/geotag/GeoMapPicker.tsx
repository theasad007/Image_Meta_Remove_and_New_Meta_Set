"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Screen 09 optional interactive map (privacy-gated).
 *
 * The map is OFFLINE until the user deliberately enables it. Enabling shows
 * a clear third-party disclosure BEFORE any tile request: OpenStreetMap
 * raster tiles are fetched from openstreetmap.org (ODbL content, fair-use
 * tile policy) and the tile server necessarily learns the viewed viewport
 * and the requester's network address. Nothing else ever leaves the
 * browser — no image bytes, filenames, EXIF, or inspection results.
 *
 * Leaflet is loaded through a lazy `import("leaflet")` the first time the
 * user consents, so the static export makes zero map requests while the
 * feature is closed. The marker is a divIcon circle (no bundled image
 * assets), coordinates sync through imperative map events (no feedback
 * loops), and the map instance is destroyed on close.
 */

export interface GeoMapPickerProps {
  /** Signed decimal degrees to show when opened; null = world view. */
  latitude: number | null;
  longitude: number | null;
  /** Fires on click and marker drag (signed decimals). */
  onPick: (latitude: number, longitude: number) => void;
  /** Center the view back on the image's original location. */
  onCenterOriginal: (() => void) | null;
}

const OSM_ATTRIBUTION = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors (ODbL)';

export default function GeoMapPicker({ latitude, longitude, onPick, onCenterOriginal }: GeoMapPickerProps) {
  const [consented, setConsented] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "ready" | "failed">("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  /** Guards the one-shot lazy load so re-renders never double-create maps. */
  const startedRef = useRef(false);
  /** Latest props read inside imperative callbacks without re-binding. */
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const clampLng = (lng: number): number => Math.max(-180, Math.min(180, lng));

  const moveMarker = (lat: number, lng: number) => {
    const leaflet = leafletRef.current;
    if (!leaflet || !mapRef.current) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = leaflet.marker([lat, lng], { icon: leaflet.divIcon({ className: "geotag-marker", iconSize: [18, 18] }), draggable: true, keyboard: false }).addTo(mapRef.current);
      markerRef.current.on("dragend", () => {
        const position = markerRef.current?.getLatLng();
        if (position) onPickRef.current(position.lat, clampLng(position.lng));
      });
    }
  };

  useEffect(() => {
    if (!consented || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const leaflet = await import("leaflet");
        await import("leaflet/dist/leaflet.css");
        if (cancelled || !containerRef.current) return;
        leafletRef.current = leaflet;
        const map = leaflet.map(containerRef.current, {
          center: [latitude ?? 20, longitude ?? 0],
          zoom: latitude === null ? 2 : 12,
          attributionControl: true,
        });
        leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: OSM_ATTRIBUTION,
        }).addTo(map);
        const icon = leaflet.divIcon({ className: "geotag-marker", iconSize: [18, 18] });
        const marker = latitude !== null && longitude !== null
          ? leaflet.marker([latitude, longitude], { icon, draggable: true, keyboard: false }).addTo(map)
          : null;
        markerRef.current = marker ?? null;
        map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
          const { lat, lng } = event.latlng;
          moveMarker(lat, lng);
          onPickRef.current(lat, clampLng(lng));
        });
        marker?.on("dragend", () => {
          const position = marker.getLatLng();
          onPickRef.current(position.lat, clampLng(position.lng));
        });
        mapRef.current = map;
        setLoadState("ready");
      } catch {
        if (!cancelled) {
          setLoadState("failed");
          setStatusLine("The map library could not be loaded. Manual coordinate editing stays fully available.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally one-shot per consent: the map instance is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consented]);

  /** Sync external coordinate edits (inputs, search, geolocation) → marker. */
  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map || loadState !== "ready") return;
    if (latitude === null || longitude === null) return;
    moveMarker(latitude, clampLng(longitude));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, loadState]);

  // Destroy the map (and its tile listeners) when the editor closes.
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  const centerOn = (lat: number | null, lng: number | null) => {
    const map = mapRef.current;
    if (!map || lat === null || lng === null) return;
    map.setView([lat, clampLng(lng)], Math.max(map.getZoom(), 12));
    moveMarker(lat, clampLng(lng));
  };

  if (!consented) {
    return (
      <div className="rounded-2xl border border-[#dbe7f8] bg-[#eef4ff] p-3.5" data-testid="geotag-map-consent">
        <p className="text-[12.5px] font-extrabold text-[#16244a]">Interactive map (optional, off by default)</p>
        <p className="mt-1 text-[11.5px] leading-4 text-[#3b4a66]">
          Image processing always stays inside this browser. If you enable the map, this app loads map
          tiles from <strong>OpenStreetMap</strong> (© OpenStreetMap contributors, ODbL). The map provider
          receives your network request and the map area being viewed. No image data, filenames or
          metadata are ever sent — and every coordinate below can be typed by hand without the map.
        </p>
        <button
          type="button"
          data-testid="geotag-map-enable"
          onClick={() => setConsented(true)}
          className="btn-secondary mt-2 !min-h-9 !px-3 !py-1.5 text-[12px]"
        >
          Enable the online map
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#dbe7f8] bg-white p-2.5" data-testid="geotag-map">
      <div className="relative h-64 overflow-hidden rounded-xl border border-[#e6ebf3]" data-testid="geotag-map-container">
        {loadState === "failed" ? (
          <div className="grid h-full place-items-center px-4 text-center text-[11.5px] text-[#5a6b85]" role="status">
            The map could not load. Manual coordinate editing keeps working — no coordinates were sent anywhere.
          </div>
        ) : (
          <div ref={containerRef} className="h-full w-full" aria-label="Interactive map for choosing GPS coordinates" role="application" />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="geotag-map-center-original"
          disabled={!onCenterOriginal}
          onClick={() => onCenterOriginal?.()}
          className="btn-secondary !min-h-8 !px-2.5 text-[11px]"
        >
          Center on original location
        </button>
        <button
          type="button"
          data-testid="geotag-map-center-current"
          onClick={() => centerOn(latitude, longitude)}
          disabled={latitude === null || longitude === null}
          className="btn-secondary !min-h-8 !px-2.5 text-[11px]"
        >
          Center on current coordinates
        </button>
        <p className="ml-auto text-[10px] leading-3 text-slate-400" dangerouslySetInnerHTML={{ __html: OSM_ATTRIBUTION }} />
      </div>
      {statusLine ? <p className="mt-1.5 text-[11px] font-medium text-amber-800" role="status">{statusLine}</p> : null}
      <p className="mt-1 text-[10.5px] leading-3 text-slate-400" role="note">
        Click the map or drag the marker to set coordinates — the fields below stay in sync. Tiles © OpenStreetMap contributors.
      </p>
    </div>
  );
}
