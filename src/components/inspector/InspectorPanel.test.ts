import { describe, expect, it } from "vitest";
import { aiIndicatorReactKey } from "./InspectorPanel";
import type { AiIndicator } from "../../types/inspection";

const repeatedClaimGenerator: AiIndicator = {
  label: "C2PA claim names Claim Generator",
  evidenceGroup: "C2PA / Content Credentials",
  evidenceKey: "Claim Generator",
  matchedValue: "OpenAI GPT-Image",
  confidence: "explicit",
  explanation: "Repeated signed claim evidence.",
};

describe("InspectorPanel AI indicator keys", () => {
  it("keeps repeated C2PA Claim Generator indicators visible with unique keys", () => {
    const indicators = [repeatedClaimGenerator, { ...repeatedClaimGenerator }];
    const keys = indicators.map((indicator, index) => aiIndicatorReactKey(indicator, index));

    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain("C2PA / Content Credentials:Claim Generator");
    expect(keys[1]).not.toBe(keys[0]);
  });
});
