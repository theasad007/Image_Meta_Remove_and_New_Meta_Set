import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeMp3 } from "./id3";
import { inspectAudio } from "./inspect-audio";
import { verifyRewrittenAudio } from "./rewrite-verify";
import { blankProfile, type MetadataProfile, type ProfileField } from "../rewrite/fields";
import type { RewriteMode } from "../rewrite/rewrite";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "test-fixtures");
const load = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

function profileWith(values: Partial<Record<ProfileField, string>>): MetadataProfile {
  const profile = blankProfile();
  for (const [key, value] of Object.entries(values)) {
    const text = value ?? "";
    if (key === "keywords") {
      profile.keywordsList = text.split(", ");
      profile.keywords = text;
    } else {
      profile[key as keyof MetadataProfile] = text as never;
    }
  }
  return profile;
}

async function rewrite(name: string, values: Partial<Record<ProfileField, string>>, mode: RewriteMode, fields: ProfileField[]) {
  const inputBytes = load(name);
  const before = await inspectAudio("before", new Blob([inputBytes]), name);
  return verifyRewrittenAudio({
    fileId: name,
    inputName: name,
    extension: "mp3",
    kind: "mp3-audio",
    inputBytes,
    before,
    profile: profileWith(values),
    selectedFields: fields,
    mode,
  });
}

const AUDIO_SEGMENT_LENGTH = (bytes: Uint8Array): number => {
  const probe = probeMp3(bytes);
  const end = probe.stream
    ? probe.stream.streamEnd
    : (() => {
      let tail = bytes.length;
      if (probe.id3v1) tail -= 128;
      return tail;
    })();
  return end - probe.audioStart;
};

describe("MP3 single rewrite (Phase 10, free for guests)", () => {
  it("rewrites a stream beyond the historical 4 MiB scanner boundary without losing frames", async () => {
    const fixture = load("mp3-untagged.mp3");
    const frame = fixture.subarray(0, 417);
    const count = Math.ceil((16 * 1024 * 1024 + 1) / frame.length);
    const input = new Uint8Array(count * frame.length);
    for (let index = 0; index < count; index += 1) input.set(frame, index * frame.length);
    const beforeProbe = probeMp3(input);
    expect(beforeProbe.stream?.streamEnd).toBe(input.length);
    const before = await inspectAudio("long-before", new Blob([input]), "long.mp3");
    const result = await verifyRewrittenAudio({
      fileId: "long",
      inputName: "long.mp3",
      extension: "mp3",
      kind: "mp3-audio",
      inputBytes: input,
      before,
      profile: profileWith({ title: "Long stream title" }),
      selectedFields: ["title"],
      mode: "replace_editable",
    });
    expect(result.status).toBe("verified_rewritten");
    const output = new Uint8Array(await result.output!.arrayBuffer());
    expect(probeMp3(output).stream?.frameCount).toBe(beforeProbe.stream?.frameCount);
    expect(output.length).toBeGreaterThan(input.length);
  });

  it("replace mode writes title/artist/publisher and verifies every field from output bytes", async () => {
    const result = await rewrite("mp3-untagged.mp3", {
      title: "Brand New Title",
      creator: "New Artist",
      company: "New Publisher",
      copyright: "© 2026 New",
    }, "replace_editable", ["title", "creator", "company", "copyright"]);
    expect(result.status).toBe("verified_rewritten");
    expect(result.output).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    const probe = probeMp3(bytes);
    const value = (id: string) => probe.tag!.frames.find((frame) => frame.id === id)?.values[0];
    expect(value("TIT2")).toBe("Brand New Title");
    expect(value("TPE1")).toBe("New Artist");
    expect(value("TPUB")).toBe("New Publisher");
    expect(value("TCOP")).toBe("© 2026 New");
    // MPEG payload untouched.
    const input = load("mp3-untagged.mp3");
    expect(AUDIO_SEGMENT_LENGTH(bytes)).toBe(AUDIO_SEGMENT_LENGTH(input));
  });

  it("update mode retains unrelated raw frames (artwork/lyrics) and rewrites only the requested fields", async () => {
    const result = await rewrite("mp3-id3v2.4.mp3", {
      title: "Updated über Title",
    }, "update_selected", ["title"]);
    expect(result.status).toBe("verified_rewritten");
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    const probe = probeMp3(bytes);
    expect(probe.tag!.version).toBe("v2.4"); // same version preserved
    expect(probe.tag!.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("Updated über Title");
    // Artwork + lyrics retained.
    expect(probe.tag!.frames.find((frame) => frame.id === "APIC")).toBeDefined();
    expect(probe.tag!.frames.find((frame) => frame.id === "USLT")).toBeDefined();
    // Unrelated text values survive.
    expect(probe.tag!.frames.find((frame) => frame.id === "TPE1")?.values[0]).toBe("Ünïcode Ärçst");
    // Audio untouched.
    const input = load("mp3-id3v2.4.mp3");
    expect(AUDIO_SEGMENT_LENGTH(bytes)).toBe(AUDIO_SEGMENT_LENGTH(input));
  });

  it("writes keywords and location as clearly labeled TXXX frames (never fake GPS)", async () => {
    const result = await rewrite("mp3-untagged.mp3", {
      keywords: "harbor, noon",
      locationName: "Test Harbor",
    }, "replace_editable", ["keywords", "locationName"]);
    expect(result.status).toBe("verified_rewritten");
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    const probe = probeMp3(bytes);
    const txxx = probe.tag!.frames.filter((frame) => frame.id === "TXXX");
    expect(txxx.find((frame) => frame.label === "Custom Text: KEYWORDS")?.values[0]).toBe("harbor, noon");
    expect(txxx.find((frame) => frame.label === "Custom Text: LOCATION")?.values[0]).toBe("Test Harbor");
    // No GPS frame of any kind is invented.
    expect(probe.tag!.frames.some((frame) => frame.id.startsWith("GEO") || /GPS/i.test(frame.id))).toBe(false);
    // The change ledger states the GPS honesty explicitly.
    expect(result.changes.some((change) => change.group === "GPS" && /not written to MP3/.test(change.reason ?? ""))).toBe(true);
  });

  it("website validates http(s) only; unsupported fields are disclosed, not dropped (SOL-003)", async () => {
    const result = await rewrite("mp3-untagged.mp3", {
      website: "https://studio.example.com",
      rightsOwner: "Some Owner",
      contact: "studio@example.com",
    }, "replace_editable", ["website", "rightsOwner", "contact"]);
    // All WRITABLE fields verify — a no-channel field is an explicit
    // unsupported disclosure, never a failed write or silent drop.
    expect(result.status).toBe("verified_rewritten");
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    expect(probeMp3(bytes).tag!.frames.find((frame) => frame.id === "WXXX")).toBeDefined();
    // The unsupported fields stay visible in the ledger AND warnings.
    const disclosed = result.changes.filter((change) => change.action === "unchanged" && /no verified ID3/.test(change.reason ?? "")).map((change) => change.key);
    expect(disclosed).toContain("rightsOwner");
    expect(disclosed).toContain("contact");
    expect(result.warnings.join(" ")).toMatch(/not written to MP3/);
    // No failed verification for the no-channel fields.
    expect(result.changes.filter((change) => change.verification === "failed")).toHaveLength(0);
  });

  it("removes a stale ID3v1 tail on update so v1 cannot shadow the v2 output", async () => {
    const result = await rewrite("mp3-v2-and-v1.mp3", { title: "V2 Wins Again" }, "update_selected", ["title"]);
    expect(result.status).toBe("verified_rewritten");
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    const probe = probeMp3(bytes);
    expect(probe.id3v1).toBeNull();
    expect(probe.tag!.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("V2 Wins Again");
  });

  it("update mode refuses v2.2 tags honestly (use replace mode)", async () => {
    const result = await rewrite("mp3-id3v2.2.mp3", { title: "Nope" }, "update_selected", ["title"]);
    expect(result.status).toBe("unsupported");
    expect(result.errors[0]).toMatch(/ID3v2\.2/);
  });

  it("replace mode on a v2.2 file writes a fresh v2.3 tag", async () => {
    const result = await rewrite("mp3-id3v2.2.mp3", { title: "Replaced" }, "replace_editable", ["title"]);
    expect(result.status).toBe("verified_rewritten");
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    expect(probeMp3(bytes).tag!.version).toBe("v2.3");
  });

  it("unicode and multi-line comments survive the round trip", async () => {
    const result = await rewrite("mp3-untagged.mp3", {
      creator: "Ünïcode Ärçst – 東京",
      description: "line one\nline two",
    }, "replace_editable", ["creator", "description"]);
    expect(result.status).toBe("verified_rewritten");
    const bytes = new Uint8Array(await result.output!.arrayBuffer());
    const probe = probeMp3(bytes);
    expect(probe.tag!.frames.find((frame) => frame.id === "TPE1")?.values[0]).toBe("Ünïcode Ärçst – 東京");
    expect(probe.tag!.frames.find((frame) => frame.id === "COMM")?.values[0]).toContain("line two");
  });

  it("never claims GPS writing for MP3 even when coordinates are requested", async () => {
    const result = await rewrite("mp3-untagged.mp3", { title: "T" }, "replace_editable", ["title"]);
    // GPS is never part of an MP3 rewrite result.
    expect(result.changes.every((change) => !/GPS coordinates (written|added)/.test(change.reason ?? ""))).toBe(true);
  });
});
