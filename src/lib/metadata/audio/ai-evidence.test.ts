import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeMp3 } from "./id3";
import { classifyMp3Evidence } from "./ai-evidence";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "test-fixtures");
const load = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

describe("MP3 AI evidence classification (Phase 08)", () => {
  it("detects qualified AI indicators from designated TXXX fields with exact provenance", () => {
    const probe = probeMp3(load("mp3-ai-tags.mp3"));
    const evidence = classifyMp3Evidence(probe);
    expect(evidence.status).toBe("qualified-indicator");
    // The TXXX:AI_GENERATOR frame names a known generator — explicit.
    const generator = evidence.indicators.find((indicator) => indicator.evidenceKey.includes("AI_GENERATOR") || indicator.evidenceKey.includes("ai_generator"));
    expect(generator).toBeDefined();
    expect(generator?.confidence).toBe("explicit");
    expect(generator?.evidenceGroup).toBe("ID3");
    // The DigitalSourceType disclosure is its own explicit indicator.
    const sourceType = evidence.indicators.find((indicator) => indicator.evidenceKey.toLowerCase().includes("digitalsourcetype"));
    expect(sourceType).toBeDefined();
  });

  it("never scans ordinary artist/title text (an 'AI' word in a title is not evidence)", () => {
    // mp3-ai-tags.mp3 has TPE1 "Regular Artist" and TIT2 "Synth Track" —
    // neither may produce an indicator.
    const probe = probeMp3(load("mp3-ai-tags.mp3"));
    const evidence = classifyMp3Evidence(probe);
    for (const indicator of evidence.indicators) {
      expect(indicator.evidenceKey).not.toBe("TIT2");
      expect(indicator.evidenceKey).not.toBe("TPE1");
    }
  });

  it("reports a C2PA-like GEOB carrier as detected but NOT validated", () => {
    const probe = probeMp3(load("mp3-geob-c2pa.mp3"));
    const evidence = classifyMp3Evidence(probe);
    expect(evidence.status).toBe("c2pa-carrier-detected");
    expect(evidence.summary).toMatch(/NOT performed/i);
    expect(evidence.summary).not.toMatch(/verified/i);
    expect(evidence.summary).not.toMatch(/cryptographically valid/i);
  });

  it("treats non-C2PA GEOB as an ordinary object (no carrier claim)", () => {
    const probe = probeMp3(load("mp3-geob-other.mp3"));
    const evidence = classifyMp3Evidence(probe);
    expect(evidence.status).toBe("not-detected-in-supported-fields");
  });

  it("reports absence honestly — never 'clean', with explicit coverage limits", () => {
    const probe = probeMp3(load("mp3-id3v2.3.mp3"));
    const evidence = classifyMp3Evidence(probe);
    expect(evidence.status).toBe("not-detected-in-supported-fields");
    expect(evidence.summary).toMatch(/not proof/i);
    expect(evidence.coverage).toMatch(/TXXX/);
  });

  it("marks unparseable files as parse-error with no evidence claims", () => {
    const probe = probeMp3(load("mp3-spoofed.mp3"));
    const evidence = classifyMp3Evidence(probe);
    expect(evidence.status).toBe("parse-error");
    expect(evidence.indicators).toEqual([]);
    expect(evidence.summary).toMatch(/no AI evidence claims/i);
  });
});
