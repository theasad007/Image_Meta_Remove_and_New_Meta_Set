import type {
  ImageInspectionResult,
  InspectionCategoryResult,
} from "../../types/inspection";

/**
 * Screen 05 grouping helpers — pure functions over committed inspection
 * results. Tab panels and counter badges are derived from these; groups
 * the engine never read stay honest ("not inspected"), never zero.
 */

export type DetailTabId =
  | "overview"
  | "ai"
  | "c2pa"
  | "exif"
  | "xmp"
  | "iptc"
  | "gps"
  | "technical";

export interface DetailCategoryBuckets {
  c2pa: InspectionCategoryResult[];
  exif: InspectionCategoryResult[];
  xmp: InspectionCategoryResult[];
  iptc: InspectionCategoryResult[];
  gps: InspectionCategoryResult[];
  /** Container/technical groups: every category outside the six families. */
  technical: InspectionCategoryResult[];
}

const FAMILY_PREFIXES = ["exif", "xmp", "iptc", "gps", "c2pa"] as const;

/**
 * Bucket a result's categories into the Screen 05 tab families. Matching
 * follows the row chips' prefix rule (case-insensitive startsWith), so
 * e.g. "C2PA / Content Credentials (JUMBF)" lands in `c2pa` and PNG text
 * or container-details groups land in `technical`.
 */
export function categoriesForTabs(result: ImageInspectionResult): DetailCategoryBuckets {
  const buckets: DetailCategoryBuckets = { c2pa: [], exif: [], xmp: [], iptc: [], gps: [], technical: [] };
  for (const category of result.categories) {
    const lowered = category.category.toLowerCase();
    const family = FAMILY_PREFIXES.find((prefix) => lowered.startsWith(prefix));
    if (family) {
      buckets[family].push(category);
    } else {
      buckets.technical.push(category);
    }
  }
  return buckets;
}

export interface DetailTabCounts {
  ai: number;
  c2pa: number;
  exif: number;
  gps: number;
  xmp: number;
  iptc: number;
  technical: number;
  /** EXIF + GPS + XMP + IPTC ("Standard metadata" summary card). */
  standard: number;
  /** Sum of every category's tags ("Overall metadata summary"). */
  total: number;
  /** True when at least one browser-inspectable group could not be read. */
  hasUnreadGroups: boolean;
}

/**
 * Honest per-tab counts. `c2pa` counts the family's detected tags (the
 * tags themselves carry manifest/signer/validation detail); presence of a
 * manifest store is derived from the category status, never invented.
 */
export function detailCountsOf(result: ImageInspectionResult): DetailTabCounts {
  const tagsOf = (prefix: (typeof FAMILY_PREFIXES)[number]) => {
    const category = result.categories.find((item) => item.category.toLowerCase().startsWith(prefix));
    return category && category.status === "detected" ? category.tags.length : 0;
  };
  const exif = tagsOf("exif");
  const gps = tagsOf("gps");
  const xmp = tagsOf("xmp");
  const iptc = tagsOf("iptc");
  const c2pa = tagsOf("c2pa");
  let technical = 0;
  let unreadGroups = false;
  for (const category of result.categories) {
    const lowered = category.category.toLowerCase();
    if (!FAMILY_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
      if (category.status === "detected") technical += category.tags.length;
    }
    if (category.status === "failed" || category.status === "not_inspected" || category.status === "unsupported") {
      unreadGroups = true;
    }
  }
  return {
    ai: result.aiIndicators.length,
    c2pa,
    exif,
    gps,
    xmp,
    iptc,
    technical,
    standard: exif + gps + xmp + iptc,
    total: result.categories.reduce((sum, category) => sum + category.tags.length, 0),
    hasUnreadGroups: unreadGroups,
  };
}
