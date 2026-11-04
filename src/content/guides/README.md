# Product documentation source

The `/docs/` pages are built from `src/content/guides/content.ts`. That file is the human-editable source for article titles, summaries, categories, workflow sections, tables, screenshots, search terms, related links, and indexability. App Router pages statically export the index and one route per article.

## Adding or changing a guide

1. Verify the actual UI labels, file support, access policy, and result behavior in the application and relevant automated coverage.
2. Update the affected article in `src/content/guides/content.ts` in the same change as the product update. Use workflow steps for tasks, state unsupported cases plainly, and link related guides by slug.
3. Update the Supported formats matrix whenever a format operation changes. Update the Release notes article for user-visible behavior changes.
4. Replace screenshots in `public/help-screenshots/` when an interface change makes them misleading. Screenshots must come from the real UI and use synthetic test data; give each figure descriptive alt text and a caption.
5. Add or update coverage in `e2e/docs.spec.ts` and `e2e/docs-mobile.spec.ts` when routes, search, navigation, or responsive behavior changes.
6. After building, regenerate screenshots with `npm run docs:screenshots`. Install Chrome or Chromium and set `DOCS_CHROME_EXECUTABLE` when it is not in a standard location.
7. Run typecheck, lint, build, and the focused docs E2E tests. Confirm that every article slug is statically exported and every image path resolves.

## Content conventions

- Use exact button names from the current UI and explain them inside a user workflow.
- Keep guest, signed-in, and Premium access distinct. Do not invent prices or payment flows.
- Distinguish file preview, inspection, cleaning, rewriting, and verification.
- Do not claim universal metadata removal, visual AI detection, or video metadata support.
- Keep the public help center focused on end users. Do not add administrator procedures or privileged operational instructions to these guides.
