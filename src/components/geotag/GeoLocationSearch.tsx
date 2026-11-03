"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Screen 09 optional location search (Nominatim, explicit action only).
 *
 * Policy compliance (checked against the public Nominatim usage policy):
 * - Requests fire ONLY on an explicit button press — never search-as-you-type.
 * - One request at a time; a ≥1.2 s minimum spacing between searches keeps
 *   far below the 1 request/second ceiling.
 * - Every result is user-initiated; nothing is auto-applied without a click.
 * - Attribution is rendered with the results; the map consent governs the
 *   network itself (this component renders only when the map is enabled).
 * - Image bytes, filenames and metadata are never part of a request — the
 *   only payload is the typed place-name query string.
 * - Stale responses are discarded by sequence number; an AbortController
 *   cancels the in-flight request when the editor closes.
 */

export interface GeoSearchResult {
  label: string;
  latitude: number;
  longitude: number;
}

interface NominatimPlace {
  display_name?: string;
  lat?: string;
  lon?: string;
}

export default function GeoLocationSearch({ onPick }: { onPick: (result: GeoSearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "searching" | "error" | "done">("idle");
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const lastRunRef = useRef(0);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  const search = async () => {
    const trimmed = query.trim();
    if (trimmed === "") {
      setState("error");
      setMessage("Type a place name first — searches only run when you press the button.");
      return;
    }
    const now = Date.now();
    const wait = Math.max(0, 1200 - (now - lastRunRef.current));
    runIdRef.current += 1;
    const runId = runIdRef.current;
    setState("searching");
    setMessage(wait > 0 ? "Rate limiting to protect the free Nominatim service…" : null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
    if (runId !== runIdRef.current) return;
    lastRunRef.current = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        if (response.status === 429) throw new Error("rate-limited");
        throw new Error(String(response.status));
      }
      const payload = (await response.json()) as NominatimPlace[];
      if (runId !== runIdRef.current) return;
      const parsed: GeoSearchResult[] = [];
      for (const place of payload) {
        const lat = Number.parseFloat(place.lat ?? "");
        const lon = Number.parseFloat(place.lon ?? "");
        if (Number.isFinite(lat) && Number.isFinite(lon) && place.display_name) {
          parsed.push({ label: place.display_name, latitude: lat, longitude: lon });
        }
      }
      setResults(parsed);
      setState("done");
      setMessage(parsed.length === 0 ? "No matching place was found — you can still type the coordinates by hand." : null);
    } catch (error) {
      if (runId !== runIdRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setState("error");
      setResults([]);
      setMessage(error instanceof Error && error.message === "rate-limited"
        ? "The free Nominatim service is rate-limiting requests. Wait a moment and try again — manual coordinates remain available."
        : "The location service is unavailable. Manual coordinate editing keeps working without it.");
    }
  };

  return (
    <div className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="geotag-search">
      <p className="text-[12.5px] font-extrabold text-[#16244a]">Find a place <span className="font-semibold text-[#5a6b85]">(optional)</span></p>
      <p className="mt-0.5 text-[10.5px] leading-3.5 text-[#5a6b85]">
        Search runs only when you press the button, via the free OpenStreetMap Nominatim service (attribution required).
        Results are place names and coordinates only — never your image data.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          placeholder="New York, London, Dhaka, Tokyo, Eiffel Tower…"
          aria-label="Search for a location by name"
          data-testid="geotag-search-input"
          className="min-w-0 flex-1 rounded-xl border border-[#c9d5e8] bg-white px-3 py-2 text-[12.5px] text-[#16244a] focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
        />
        <button
          type="button"
          data-testid="geotag-search-button"
          onClick={() => void search()}
          disabled={state === "searching"}
          className="btn-secondary !min-h-9 shrink-0 !px-3 text-[12px]"
        >
          {state === "searching" ? "Searching…" : "Search"}
        </button>
      </div>
      {message ? <p className="mt-1.5 text-[11px] font-medium text-[#5a6b85]" role="status" data-testid="geotag-search-status">{message}</p> : null}
      {results.length > 0 ? (
        <ul className="mt-2 grid gap-1" data-testid="geotag-search-results">
          {results.map((result, index) => (
            <li key={`${result.label}:${index}`}>
              <button
                type="button"
                data-testid={`geotag-search-result-${index}`}
                onClick={() => onPick(result)}
                className="w-full rounded-xl border border-[#e6ebf3] bg-white px-3 py-2 text-left text-[11.5px] font-semibold text-[#16244a] hover:border-[#9db4f2] hover:bg-[#f8faff] focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
              >
                <span className="block truncate">{result.label}</span>
                <span className="block text-[10.5px] font-medium text-[#5a6b85]">
                  {result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 text-[10px] leading-3 text-slate-400">
        Search results © OpenStreetMap contributors (ODbL) via Nominatim.
      </p>
    </div>
  );
}
