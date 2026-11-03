# LUNA — Profile Dashboard Navigation Fix Report

## Scope

Implemented the requested `/account/profile/` navigation/layout fix only. The existing sidebar styling, Firebase/Auth services, profile/project/rewrite logic, entitlement behavior, and privacy copy were preserved.

## Changes

- Replaced sidebar anchor/scroll navigation with state-driven client-side panel switching.
- Kept Metadata Profile selected by default and reset to it on a new signed-in session.
- Kept the ProfileEditor and ProfilePreviewCard side-by-side at the desktop layout breakpoint, with responsive stacking below it.
- Kept ProjectsPanel and RewritePanel mounted while inactive so their draft/local UI state survives navigation.
- Moved the existing Security & Privacy content into its selected panel.
- Added an organized Connected Account panel using the already-authenticated user identity; existing sign-out/session-refresh controls remain in the compact sidebar summary.
- Inactive panels use semantic `hidden` plus `aria-hidden`, so they are not visible, keyboard reachable, or exposed to screen readers.
- Added panel relationships through `aria-controls`, `aria-labelledby`, and predictable heading focus after a navigation change.
- Preserved compatibility selectors used by existing profile journeys (`#connected-account`, `#rewrite-preferences`, `#projects`, and `#security-privacy`).

## Acceptance review

| Area | Result |
| --- | --- |
| Sidebar navigation | Pass — five items switch the visible panel without URL/hash navigation |
| Metadata Profile | Pass — editor and live preview remain together; draft state is parent-controlled and retained |
| My Projects | Pass — existing ProjectsPanel and Premium restriction remain inside selected panel |
| Rewrite Preferences | Pass — existing RewritePanel and persisted settings callbacks are unchanged |
| Connected Account | Pass — selected panel shows display name, email, UID, and connection status; sidebar summary/actions remain |
| Security & Privacy | Pass — existing content moved into selected panel |
| Old stacked sections | Removed — only the selected main panel is visible/exposed |
| Firebase/Auth/Rules/data | Unchanged |
| Homepage/footer | Unchanged by this task |

## Verification

- `npm run typecheck` — pass.
- `npm run lint` — pass with one pre-existing warning in `e2e/ux04-workspace.spec.ts:122` (`header` unused); no errors.
- `npm run build` — pass.
- Focused Vitest (`profile-view`, `project-schema`, `rewrite`) — 37/37 pass.
- Full Vitest regression (`npm test`) — 423 pass, 35 skipped, 1 test file skipped.
- Signed-out profile E2E desktop/mobile (`e2e/profile.spec.ts`, `e2e/profile-mobile.spec.ts`) — 8/8 pass.
- Signed-in Firebase emulator profile E2E was not executable in this environment because the repository runner requires Java 21+, while the available local runtime is Java 17. No production Firebase data or Rules were touched.

## Files modified

- `app/account/profile/page.tsx`
- `src/components/profile/AccountSidebar.tsx`

No application dependencies, Firebase configuration, Firestore Rules, authentication data, entitlements, homepage, or footer files were changed for this fix.

The implementation was verified locally before this owner-requested release commit. No Firebase Rules publication, billing change, or unrelated production change is included.
