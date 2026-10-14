# 09 — P0 C2PA / OpenAI Detection Proof Report (14 Oct 2026)

**Scope:** verification + justified fixes only. No Phase 6/7/8, no C2PA removal, no UI redesign, no new app dependencies.
**Baseline:** git `6d8d5a4` (“P0 baseline: post-Codex audit state”). Codex UI preserved — zero layout/style changes.
**Verdict: ACCEPT** — a genuine C2PA manifest exercises `detected` in real Chromium **and** Firefox with truthful presence-vs-trust semantics; OpenAI-positive and caption-negative cases pass; all prior tests still pass.

## 1. Owner-issue diagnosis: NOT REPRODUCED — original sample required

No owner image was provided with this task, so the exact reported failure
(“C2PA and OpenAI not identified in at least one owner-tested image”) is
**not reproduced / requires original sample**. Applying the §08 taxonomy to
what is now proven:

- `not implemented` and `not connected to UI` are **ruled out** — the
  validator runs in-browser and the `detected` path is E2E-proven below.
- `unsupported container/manifest` remains possible for exotic embeddings
  (PNG `caBX` now has a genuine parsing fixture; other untested layouts
  stay labeled unproven).
- **`metadata absent from sample` remains the leading hypothesis** for
  typical chat-downloaded AI images (no EXIF/XMP generator fields, no
  embedded store → correctly `not_detected` + zero indicators).
- Follow §08 §4.4 reproduction steps with the original file to close this.

## 2. Fixture ladder (all synthetic/test-identity, locally verifiable)

Base pixels/metadata are the project's own synthetic fixtures. Signed with
**c2patool 0.27.22** (Homebrew bottle, embedded c2pa-rs 0.90.22) using its
**built-in test certificate** (`C2PA Signer` / `C2PA Test Signing Cert`) —
no private key material created, downloaded, or committed. Cross-checked
with **ExifTool 13.55** and `c2patool` verify (local only, never uploaded).

Manifest definition used (`manifest-p0-test.json`, working copy only):

```json
{
  "claim_generator": "AI-Metadata-Remover-P0-Test",
  "claim_generator_info": [
    { "name": "AI Metadata Remover P0 proof signer", "version": "2026-10-14-test-only" }
  ],
  "title": "P0 synthetic C2PA proof fixture (test identity, untrusted)",
  "assertions": [
    { "label": "c2pa.actions",
      "data": { "actions": [
        { "action": "c2pa.created",
          "softwareAgent": { "name": "P0-Test-Renderer" },
          "digitalSourceType": "trainedAlgorithmicMedia" } ] } },
    { "label": "p0.test-provenance",
      "data": { "digitalSourceType": "trainedAlgorithmicMedia",
                "note": "Synthetic test tag only. Not evidence of real AI generation." } }
  ]
}
```

Generation commands (from the repo root; `c2pa-work/` is a scratch dir):

```bash
c2patool base-exif.jpg -m manifest-p0-test.json -o signed-c2pa.jpg --force
c2patool base-text.png -m manifest-p0-test.json -o signed-c2pa.png --force
# tampered variant: flip bit 0 of one scan-data byte (not 0xFF-adjacent)
```

Probe lesson recorded: `c2pa.created` **without** `digitalSourceType` is
flagged `assertion.action.malformed` by c2pa-rs — the final manifest
includes it, leaving only the expected untrusted-credential failure.

| Fixture | SHA-256 | Size | Independent result |
|---|---|---|---|
| `signed-c2pa.jpg` | `4d44ecc0…1b2ab6e09` | 37,383 B | c2patool: manifest present, `Valid`, failures `[signingCredential.untrusted]`; ExifTool: JUMBF `c2pa` label, `ActionsSoftwareAgentName=P0-Test-Renderer`, `DigitalSourceType=trainedAlgorithmicMedia`, store UUID at offset 591 |
| `signed-c2pa.png` | `74a78e7d…f30fa3a68d` | 36,976 B | Store in a real **`caBX`** chunk (len 36,102, UUID at +57); c2patool `Valid` + untrusted failure; same gate as JPEG |
| `jpeg-c2pa-tampered.jpg` | `22dd0949…9f4454cf3e` | 37,383 B | c2patool `Invalid`, failures `[untrusted, claimSignature.mismatch]`; still parses + Pillow-decodes |
| `jpeg-openai.jpg` | `1e2c4308…d6215dcec7` | 1,216 B | ExifTool: `CreatorTool=OpenAI GPT-Image` (**synthetic tag**, not real provenance); no C2PA store by construction |
| `jpeg-caption-openai.jpg` | `2cd80de8…be5f455a6f` | 1,208 B | ExifTool: Description mentions OpenAI, CreatorTool ordinary; must yield 0 indicators |

(Full hashes in `src/test-fixtures/README.md`.)

## 3. Browser proof (shipped path, not helpers)

`e2e/c2pa-openai.spec.ts` (5 tests) vs production `out/` — **5/5 desktop
Chrome + 5/5 Firefox**, all with zero page errors:

- **Signed JPEG → `detected`, 8 tags:** `Manifest Store=Present`,
  `Validation State=Valid`, active-manifest URN, `Claim Generator=AI
  Metadata Remover P0 proof signer …`, `Software Agent 2=P0-Test-Renderer`,
  `Digital Source Type` ×2 (action URI + short form), `Signer=C2PA Signer`;
  warning “reported **1 failure**. Do not treat the claim as trusted”;
  AI indicator “C2PA claim declares an AI-associated digital source type”;
  row chips `C2PA 8` / `AI 2`.
- **Tampered → `detected` + `reported 2 failures`** (“Do not treat…”);
  never absent, never silently valid.
- **Ordinary + dummy-APP11 → `not_detected`** + “No embedded C2PA Manifest
  Store identifier was found” (dummy marker provably never preflight-hits).
- **OpenAI:** `CreatorTool=OpenAI GPT-Image` → 1 explicit indicator, chip
  `OpenAI 1`; caption-only mention → 0 indicators, chip `AI 0`, panel text
  “No AI-associated metadata indicators found”.
- **Cleaning a signed file:** `partially cleaned` (never `verified_clean`);
  output re-inspects `Invalid` + **3 failures** while UUID bytes persist and
  EXIF verifies removed — provenance retained *and* honestly broken.
- Network locality holds over these flows (existing `queue.spec.ts`
  request-log proof passes in the same run; no fetch/XHR/Beacon in `src/`).

## 4. Code pointers (final line numbers)

- Preflight + validator: `src/lib/metadata/inspect/c2pa.ts:13-16`
  (exported UUID), `:28-34` (exported gate), `:122-201` (`inspectC2pa`
  states), `:157-186` (generator/source-type/AI extraction).
- Overlay: `src/lib/metadata/inspect/inspect.ts:66-84`, called `:164-166`.
- OpenAI rules: `src/lib/metadata/inspect/ai-indicators.ts:20-50,69-134`.
- UI (unchanged): `src/components/queue/QueueItem.tsx:97-122` (chips),
  `src/components/inspector/InspectorPanel.tsx:37-96,140-177` (truthful pills).
- Retention (unchanged behavior, corrected copy only):
  `src/lib/metadata/clean/jpeg.ts:319-325`,
  `src/lib/metadata/clean/isobmff.ts:697-701`,
  `src/lib/metadata/verify/verify.ts:306-315`.

## 5. Bugs fixed (2 copy defects + test-only exports; behavior preserved)

1. `clean/jpeg.ts:323` claimed “C2PA is not inspected in Phase 3” on a panel
   that simultaneously shows a `detected` C2PA section — reworded to
   “ordinary cleaning does not remove signed provenance.”
2. `clean/isobmff.ts:700` same staleness (“C2PA is not inspected”) — reworded
   to “JUMBF/C2PA removal is not supported.”
3. `c2pa.ts`: added `export` to `C2PA_STORE_UUID` + `hasEmbeddedManifestStore`
   (unit-test access; zero runtime change). No layout, style, engine, ZIP,
   report, or guest-flow change.

## 6. Full validation (exact, this milestone)

```text
npm run typecheck   → clean (tsc --noEmit, exit 0)
npm run lint        → clean (eslint ., exit 0)
npm run test        → 17 files / 151 passed (was 16/142; +1 file, +9 tests)
npm run build       → clean (Next.js 16.4.0, 3/3 static pages)
npm audit --omit=dev → 0 vulnerabilities
npm run test:e2e    → 58 passed (was 48; +5 desktop +5 Firefox), ~3.2 min,
                      incl. journeys, bulk/ZIP extract + re-inspect, CSV/PDF,
                      robustness, queue, scale, a11y/mobile, upload, c2pa-openai
```

## 7. Inspection vs removal (never conflated)

- **C2PA inspection:** integrated + fixture-proven (`detected` /
  `not_detected` / `not_inspected` all exercised in-browser).
- **C2PA removal:** **not implemented** — APP11/`uuid`/`jumb` retained
  verbatim; any manifest-bearing output caps at `partially_cleaned`;
  §02 Class-D removal rows intentionally unchanged.

## 8. Remaining limitations / next scope (needs approval)

- Owner-image diagnosis still open (§1); PNG `caBX` *removal* and exotic
  JUMBF layouts unproven; iPhone Apple-encoder HEIC still wanted.
- Optional (proposed, **not implemented** pending approval): row chips read
  `C2PA 0`/`AI 0` also when the category is `not_inspected` — details panel
  is accurate one click away, so no misrepresentation was demonstrated, but
  a `C2PA –`-style neutral chip for `not_inspected` would remove all doubt.
- Recommended next: owner supplies original sample (or regenerable
  equivalent) for §1 closure; otherwise proceed to Phase 6 planning.
  **STOP — do not start Phase 6/7/8 or C2PA removal without approval.**
