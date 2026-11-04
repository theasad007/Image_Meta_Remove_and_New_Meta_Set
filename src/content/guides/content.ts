/**
 * Public product documentation source. Keep user-facing workflow guidance here
 * and update the related page whenever product behavior or labels change.
 */
export type DocBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: Array<{ title: string; text: string }> }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "callout"; tone: "note" | "warning" | "success"; title: string; text: string }
  | { type: "image"; src: string; alt: string; caption: string };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export interface DocArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  sections: DocSection[];
  related: string[];
  searchTerms?: string[];
  indexable?: boolean;
}

export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: "quick-start",
    title: "Quick start",
    description: "Choose a tool, add files, review metadata, and create a verified clean or rewritten copy.",
    category: "Getting started",
    related: ["inspect-metadata", "clean-metadata", "supported-formats"],
    searchTerms: ["introduction", "workspace", "upload", "choose files", "tool selection"],
    sections: [
      { id: "what-the-app-does", title: "What the app does", blocks: [
        { type: "paragraph", text: "Private Metadata Cleaner reads supported image metadata in your browser. You can inspect findings, remove supported metadata, rewrite selected fields, and download a separate output. The original file in its source location is not changed." },
        { type: "callout", tone: "note", title: "Local processing", text: "Media bytes are processed in the browser and are not uploaded. Google sign-in and optional location lookup are separate network features; see Privacy and account data for details." },
      ] },
      { id: "first-workflow", title: "Your first workflow", blocks: [
        { type: "steps", items: [
          { title: "Open the workspace", text: "Go to the home page. Choose AI Metadata Detector & Remover to prioritize supported AI-related metadata evidence, or Metadata & GeoTag Manager to focus on general tags such as EXIF, GPS, XMP, and IPTC. Both tools use the same file queue." },
          { title: "Add files", text: "Select Choose files or use the upload area. The app checks file bytes to identify supported formats; the filename alone does not establish support." },
          { title: "Review findings", text: "Wait for inspection to finish, then open View details on a supported image. Read the status and any warnings before choosing an operation." },
          { title: "Choose an operation", text: "Use Remove Metadata for broad supported metadata cleaning, Remove AI Metadata for the narrower AI-evidence workflow, or Edit to enter new metadata for a supported image." },
          { title: "Check and download", text: "Review the result status and verification details. Download the separate output only when the app offers it. For several outputs, use Download ZIP." },
        ] },
        { type: "image", src: "/help-screenshots/workspace.jpg", alt: "Private Metadata Cleaner workspace with the two metadata tools and local file upload area", caption: "Workspace screenshot captured from the app. Example file and metadata values use synthetic test data." },
      ] },
      { id: "before-you-begin", title: "Before you begin", blocks: [
        { type: "list", items: ["Guests can inspect, clean single or multiple files, create ZIP downloads and export reports without an account.", "A single custom rewrite is available without signing in. Sign in to save or apply your Metadata Profile.", "Premium access is required by default for batch metadata rewriting, bulk GPS writing and multiple named projects. There is no public subscription checkout at this time.", "MP4, MOV, and WebM are preview-only. Their metadata is not inspected, cleaned, or rewritten." ] },
      ] },
    ],
  },
  {
    slug: "supported-formats",
    title: "Supported formats",
    description: "Compare inspection, cleaning, rewriting, GPS, and preview support across image and video files.",
    category: "Getting started",
    related: ["inspect-metadata", "clean-metadata", "rewrite-metadata"],
    searchTerms: ["JPEG", "JPG", "PNG", "WebP", "AVIF", "HEIC", "HEIF", "MP4", "MOV", "WebM", "file format", "animation"],
    sections: [
      { id: "capability-matrix", title: "Capability matrix", blocks: [
        { type: "paragraph", text: "The app identifies files from their bytes and checks whether their internal structure matches a supported layout. A recognized extension or browser preview does not guarantee that every metadata operation is supported." },
        { type: "table", headers: ["Format", "Queue", "Preview", "Inspect", "Clean", "Rewrite", "GPS", "Important limits"], rows: [
          ["JPEG / JPG", "Yes", "Usually", "Yes", "Yes", "Yes", "Supported layouts", "EXIF, XMP and IPTC writing; supported metadata families can be cleaned. Encoded image payload is preserved."],
          ["PNG", "Yes", "Yes", "Yes", "Yes", "Yes", "Supported EXIF/XMP layouts", "Rewrite writes EXIF and XMP. IPTC is not a supported rewrite channel. Pixels are not re-encoded."],
          ["WebP still", "Yes", "Browser-dependent", "Yes", "Yes", "Yes", "Supported still layouts", "Rewrite writes EXIF and XMP. Animated WebP is safely refused."],
          ["AVIF still", "Yes", "Browser-dependent", "Yes", "Yes", "Yes", "Supported still layouts", "Only supported still-image structures are handled; image payload is preserved."],
          ["HEIC / HEIF still", "Yes", "Browser-dependent; local decode may be used", "Supported layouts", "Supported layouts", "Supported layouts", "Supported still layouts", "No conversion fallback. Generic or sequence layouts may be refused; preview support varies by browser."],
          ["MP4 / MOV / WebM", "Yes", "Preview only when browser supports it", "No", "No", "No", "No", "Video metadata is not inspected, cleaned, or rewritten."],
        ] },
        { type: "callout", tone: "warning", title: "A successful preview is not a metadata result", text: "Video files remain preview-only even when playback works. HEIC and some still formats can also be inspected without an inline preview." },
      ] },
      { id: "ai-evidence-by-format", title: "AI evidence by format", blocks: [
        { type: "table", headers: ["Format", "AI-related metadata evidence"], rows: [
          ["JPEG / JPG, PNG, WebP, AVIF, HEIC / HEIF", "The inspector looks for supported metadata indicators and attempts to read a compatible embedded C2PA manifest. A missing indicator is not proof that a file was not AI-generated."],
          ["MP4 / MOV / WebM", "Not inspected; preview only."],
        ] },
      ] },
      { id: "metadata-channels", title: "Metadata channels by image format", blocks: [
        { type: "table", headers: ["Image format", "Rewrite channels", "Cleaning notes"], rows: [
          ["JPEG / JPG", "EXIF + XMP + IPTC", "Supported EXIF, GPS, XMP, IPTC, comment, and recognized evidence structures are handled with explicit verification."],
          ["PNG", "EXIF + XMP", "Text chunks and supported metadata chunks are processed; technical image properties are preserved as required."],
          ["WebP, AVIF, HEIC / HEIF", "EXIF + XMP", "Requested IPTC writes are reported as unsupported. Unknown or unsupported structures are retained and disclosed when they affect coverage."],
        ] },
        { type: "paragraph", text: "For all formats, unsupported or malformed structures can lead to a Partial, Unsupported, Failed, or not-verified result. The app does not claim that every proprietary metadata structure can always be removed." },
      ] },
      { id: "format-handling", title: "How to process a format", blocks: [
        { type: "steps", items: [
          { title: "Choose files", text: "Use Choose files in the header or the workspace upload area. Multiple files can be selected." },
          { title: "Wait for the byte check", text: "The queue checks the actual file signature and structure. A format that is preview-only or unsupported stays out of metadata operations." },
          { title: "Read the row status", text: "Open View details or Edit only when the corresponding control is offered. For unsupported structures, use the status and warning to decide whether to try a different copy." },
        ] },
        { type: "callout", tone: "note", title: "No conversion fallback", text: "The app does not convert an image through a canvas as a workaround for an unsupported metadata operation. If a structure cannot be safely handled, it reports the limit instead." },
      ] },
    ],
  },
  {
    slug: "inspect-metadata",
    title: "Inspect image metadata",
    description: "Open the details view and understand the metadata categories, statuses, and source values it reports.",
    category: "Inspection",
    related: ["ai-evidence", "supported-formats", "clean-metadata", "gps-location"],
    searchTerms: ["EXIF", "IPTC", "XMP", "GPS", "metadata tags", "view details"],
    sections: [
      { id: "inspect-workflow", title: "Inspect a supported image", blocks: [
        { type: "steps", items: [
          { title: "Add an image", text: "Choose one supported JPEG, PNG, WebP, AVIF, or HEIC/HEIF still image. The queue begins local inspection after the file passes its format check." },
          { title: "Open the findings", text: "Select View details on the queue row. If inspection is still pending, wait for it to finish; use Inspect metadata if the row offers that action." },
          { title: "Review categories", text: "Use the details tabs to review available fields, including EXIF, XMP, IPTC, GPS, AI evidence, and Content Credentials when those structures are present and readable." },
          { title: "Check warnings", text: "A group can be Not inspected, Unsupported, Uncertain, or Failed. Read the notes before assuming a field is absent." },
        ] },
        { type: "image", src: "/help-screenshots/inspector.jpg", alt: "Metadata details view for a synthetic JPEG showing general tag findings", caption: "The displayed sample fields are fictional test metadata; do not use them as real location or camera information." },
      ] },
      { id: "metadata-families", title: "What the metadata families mean", blocks: [
        { type: "table", headers: ["Family", "Typical information"], rows: [
          ["EXIF", "Camera or software details, capture time, orientation, and sometimes GPS coordinates."],
          ["IPTC", "Editorial descriptions, creator, rights, keywords, and related publishing information."],
          ["XMP", "Extensible descriptions and application metadata; it can include overlapping or duplicated values."],
          ["GPS", "Coordinates and related location fields embedded in supported image metadata."],
          ["Technical data", "Dimensions, encoding, color profile, or structural values needed to display the file. These are not necessarily privacy findings."],
        ] },
      ] },
      { id: "status-meaning", title: "Read inspection statuses carefully", blocks: [
        { type: "list", items: ["Detected means the inspector found a matching value or structure.", "Not detected means the checked structure did not contain the requested evidence.", "Not inspected means the app did not complete that check; it is not the same as absence.", "Uncertain or Partial means only part of the relevant data could be read.", "Unsupported means the file layout or metadata family is outside the verified path." ] },
        { type: "callout", tone: "note", title: "The source file stays unchanged", text: "Inspection reads a local copy of the selected bytes. It does not edit the source image." },
      ] },
    ],
  },
  {
    slug: "ai-evidence",
    title: "Understand AI metadata evidence",
    description: "Learn what metadata-based AI indicators and Content Credentials can tell you, and what they cannot prove.",
    category: "Inspection",
    related: ["inspect-metadata", "clean-metadata", "supported-formats"],
    searchTerms: ["AI generated", "AI evidence", "C2PA", "Content Credentials", "provenance", "validator"],
    sections: [
      { id: "what-is-checked", title: "What the AI tool checks", blocks: [
        { type: "paragraph", text: "AI Metadata Detector & Remover looks for supported metadata indicators and Content Credentials structures that can be read from the selected file. It reports evidence found in those structures; it does not analyze pixels to decide how an image was made." },
        { type: "steps", items: [
          { title: "Select the AI tool", text: "Choose AI Metadata Detector & Remover in the workspace. The file queue is shared with Metadata & GeoTag Manager, so switching tools does not create a second queue." },
          { title: "Inspect a supported file", text: "Add a supported still image and open View details. Review the AI evidence and Content Credentials sections, including their verification status and warnings." },
          { title: "Choose a removal action if needed", text: "Use Remove AI Metadata to remove supported AI-related evidence. The cleaning result reports what was actually removed, retained, or not verified." },
        ] },
      ] },
      { id: "c2pa", title: "C2PA and Content Credentials", blocks: [
        { type: "paragraph", text: "When a compatible manifest is present and the browser validator can inspect it, the app reports validation details. A credential can be present but invalid, expired, untrusted, incomplete, or not inspected. Read the exact status instead of treating the presence of a manifest as proof of origin." },
        { type: "callout", tone: "warning", title: "No authorship verdict", text: "A missing indicator does not prove that a file was not generated by AI. A detected indicator does not prove who created the file or that the claim is trustworthy. This tool is not visual AI detection and cannot prove whether an image is AI-generated." },
      ] },
      { id: "removal-impact", title: "What removal changes", blocks: [
        { type: "list", items: ["Remove AI Metadata targets supported metadata evidence; the cleaner may need to remove a containing metadata family if safe single-tag surgery is not available.", "A C2PA manifest may be removed only when its container is structurally identified and the selected operation covers it.", "Changing file bytes can invalidate signed credentials. The app does not forge, recreate, or promise valid provenance after rewriting." ] },
      ] },
    ],
  },
  {
    slug: "clean-metadata",
    title: "Remove metadata from an image",
    description: "Use the general cleaning workflow, review verification, and download a separate cleaned copy.",
    category: "Cleaning",
    related: ["ai-evidence", "bulk-cleaning", "downloads-reports", "supported-formats"],
    searchTerms: ["remove metadata", "clean image", "verified clean", "download cleaned image"],
    sections: [
      { id: "single-image-clean", title: "Clean one image", blocks: [
        { type: "steps", items: [
          { title: "Add a supported still image", text: "Choose a JPEG, PNG, WebP, AVIF, or supported HEIC/HEIF image and wait for the queue check." },
          { title: "Start general cleaning", text: "Select Remove Metadata for the eligible file. To clean multiple queued files, use the same workspace action; guest bulk cleaning is currently available." },
          { title: "Review the result", text: "The app creates a separate output in browser memory, then re-inspects it. Read the result status and the change list, including retained unsupported structures or warnings." },
          { title: "Download the output", text: "Use Download cleaned image when offered. A Partial output is clearly labeled and its warning should be reviewed before sharing." },
        ] },
        { type: "image", src: "/help-screenshots/clean-result.jpg", alt: "Verified output result panel showing a cleaning status and download control", caption: "Synthetic test image and fictional metadata values; screenshot contains no user data." },
      ] },
      { id: "what-is-removed", title: "What the cleaner targets", blocks: [
        { type: "paragraph", text: "The cleaner removes supported metadata families for the selected format, such as EXIF, GPS, XMP, IPTC, comments, or recognized AI-related structures. Technical values such as image pixels, orientation, or color profiles may be retained when needed to preserve display behavior." },
        { type: "callout", tone: "warning", title: "Removal coverage is format-specific", text: "Proprietary, unknown, malformed, or unrecognized structures may be retained or cause a partial result. The report lists what the app verified; it does not claim every conceivable metadata value is gone." },
      ] },
      { id: "verification", title: "Understand the result", blocks: [
        { type: "table", headers: ["Result", "What it means"], rows: [
          ["Verified clean", "The output was re-read and the targeted supported metadata was verified as removed."],
          ["Unchanged — no target tags", "The check found no matching removable tags for that operation; the output is unchanged for those targets."],
          ["Partial", "Some targeted metadata was changed, but one or more items could not be safely removed or verified."],
          ["Not verified / Failed / Unsupported", "The app could not confirm a safe output. Do not treat this as a successful clean; use the original or try a supported file copy."],
        ] },
      ] },
    ],
  },
  {
    slug: "bulk-cleaning",
    title: "Clean multiple files and create a ZIP",
    description: "Select several supported files, run free bulk cleaning, review per-file outcomes, and download eligible results together.",
    category: "Cleaning",
    related: ["clean-metadata", "downloads-reports", "supported-formats", "rewrite-metadata"],
    searchTerms: ["batch", "bulk", "multiple files", "ZIP", "select all", "partial outputs"],
    sections: [
      { id: "bulk-workflow", title: "Run bulk cleaning", blocks: [
        { type: "steps", items: [
          { title: "Add files", text: "Choose multiple files at once or select Add files from the queue toolbar. Supported images can be processed; preview-only videos remain unsupported for metadata operations." },
          { title: "Choose the cleaning scope", text: "Use Remove Metadata to clean supported metadata broadly, or Remove AI Metadata for supported AI-related evidence. Guest bulk cleaning is currently available. If access changes, the workspace will show a notice." },
          { title: "Track each file", text: "The progress summary reports processed, verified, unchanged, partial, failed, and unsupported files. A file can fail without preventing other eligible files from finishing." },
          { title: "Create the archive", text: "After results are ready, select Download ZIP. Verified outputs are included. Partial outputs are excluded by default; check Include partial outputs in ZIP only after reviewing their warnings." },
        ] },
        { type: "image", src: "/help-screenshots/batch-outputs.jpg", alt: "Workspace showing verified output download and ZIP controls", caption: "Example state uses local synthetic fixture files; values are fictional." },
      ] },
      { id: "zip-inclusions", title: "What goes into the ZIP", blocks: [
        { type: "list", items: ["Eligible verified output files are added with their output filenames.", "Partial outputs are excluded unless you select Include partial outputs in ZIP (off by default).", "Failed, canceled, unsupported, and not-verified files are not presented as verified outputs.", "You may choose None, CSV, PDF, or CSV + PDF in Report options to add reports to the archive.", "A safety limit rejects very large archives; if report packaging fails, the app can offer Download ZIP without reports." ] },
      ] },
      { id: "cleaning-vs-rewriting", title: "Bulk cleaning and batch rewriting", blocks: [
        { type: "callout", tone: "note", title: "Different operations, different access", text: "Bulk cleaning is currently included in guest access. Rewriting selected fields across multiple images is a separate feature that requires Premium access by default. See Premium projects and access." },
      ] },
    ],
  },
  {
    slug: "rewrite-metadata",
    title: "Edit or rewrite metadata",
    description: "Enter supported values, preview planned changes, choose a rewrite mode, and verify the new image output.",
    category: "Rewriting",
    related: ["gps-location", "account-profile", "projects-premium"],
    searchTerms: ["rewrite", "Edit", "Basic info", "Advanced", "replace", "update selected fields", "guest"],
    sections: [
      { id: "open-editor", title: "Open Edit Metadata", blocks: [
        { type: "steps", items: [
          { title: "Add a supported image", text: "After the file appears in the queue, choose Edit on its row. The editor opens for that file." },
          { title: "Enter values", text: "In Basic info, enter the supported company, creator, copyright, rights, website, contact, title, description, keywords, or descriptive location name values offered for that format." },
          { title: "Choose a source", text: "In Preset & Profile, keep Custom values for this image, select a saved profile after signing in, or select an available project. A value you type for the image takes precedence for that image." },
          { title: "Preview and apply", text: "Select Preview changes to review planned field destinations. Then select Apply & create clean copy. The app writes a separate output and re-reads it before offering download." },
        ] },
        { type: "image", src: "/help-screenshots/editor.jpg", alt: "Edit Metadata dialog showing the Basic info tab and supported fields", caption: "Editor screenshot uses a synthetic JPEG and fictional sample values." },
      ] },
      { id: "rewrite-modes", title: "Choose a rewrite mode", blocks: [
        { type: "table", headers: ["Mode", "Behavior", "Use it when"], rows: [
          ["Replace removable editable metadata, then write", "Default. Runs the verified cleaner on removable non-technical metadata, then writes selected supported values. Technical ICC, orientation, and encoded pixels are retained as needed; unsupported provenance is disclosed.", "You want to replace existing editable metadata with the values you selected."],
          ["Update selected fields", "Writes only selected supported fields and keeps unrelated metadata. Prior GPS, AI, or provenance information may remain. Retained C2PA is re-validated; editing may invalidate its signature.", "You intentionally want to preserve other metadata and understand what may remain."],
        ] },
        { type: "callout", tone: "warning", title: "Rewrite is not the same as cleaning", text: "Update selected fields does not silently clean the file. Read the preview and result warnings, especially when the file contains privacy-sensitive data or signed Content Credentials." },
      ] },
      { id: "guest-and-batch", title: "Guest, profile, and batch access", blocks: [
        { type: "list", items: ["A guest can rewrite one image with image-specific values without saving a profile.", "Sign in to save and apply a Metadata Profile.", "Rewriting multiple images in one batch requires Premium access by default. Check the workspace for the current availability of Premium features.", "Per-format writer channels differ. JPEG supports EXIF, XMP, and IPTC; PNG, WebP, AVIF, and HEIC/HEIF support EXIF and XMP. Unsupported requested channels are reported." ] },
      ] },
    ],
  },
  {
    slug: "gps-location",
    title: "GPS and location metadata",
    description: "Inspect coordinates, write or remove GPS on supported still images, and understand the optional map and location lookup.",
    category: "Rewriting",
    related: ["inspect-metadata", "rewrite-metadata", "projects-premium", "privacy-security"],
    searchTerms: ["GeoTag", "latitude", "longitude", "altitude", "map", "Nominatim", "OpenStreetMap", "GPS removal"],
    sections: [
      { id: "edit-gps", title: "Add or update GPS for one image", blocks: [
        { type: "steps", items: [
          { title: "Open the image editor", text: "Choose Edit for a supported still image, then open Location (GPS). The tab separates the descriptive Location Name field from actual coordinates." },
          { title: "Enter coordinates", text: "Type decimal-degree Latitude and Longitude. Latitude must be between −90 and +90; longitude between −180 and +180. Altitude in meters is optional. Use original coordinates if you want to copy detected values into the form." },
          { title: "Review the plan", text: "Check Preview changes. It describes the planned GPS change, but is not proof that the file was written." },
          { title: "Apply and verify", text: "Select Apply GPS to this image, confirm the write, and wait for the output to be re-inspected. The UI labels coordinates as Applied GPS (verified) only when they are observed again in the produced bytes." },
        ] },
        { type: "image", src: "/help-screenshots/gps-editor.jpg", alt: "Location GPS editor with original coordinates, decimal-degree fields, and a planned change preview", caption: "Synthetic fixture screenshot; all displayed coordinates are fictional and should not be copied as real location data." },
      ] },
      { id: "remove-gps", title: "Remove GPS", blocks: [
        { type: "paragraph", text: "From Location (GPS), choose Remove GPS location and review the removal confirmation. The output is checked again for supported coordinate-bearing EXIF GPS and standard XMP mirrors. A partial result can be reported if coordinate-bearing metadata remains." },
        { type: "callout", tone: "warning", title: "GPS cleaning is format- and structure-specific", text: "The tool reports the verified result for supported structures. Do not assume unknown proprietary location fields were removed if the result says Partial or lists retained data." },
      ] },
      { id: "location-sources", title: "Map, place search, and current location", blocks: [
        { type: "list", items: ["Manual coordinates are available without the map or search service.", "Use the map only after opting in to load map tiles. Map requests go to the displayed OpenStreetMap tile provider.", "A place-name search contacts the Nominatim service only when you submit a search. The typed query and your network address reach that provider; image bytes, filename, and metadata are not sent.", "Use my current location asks the browser for location permission only after you click it. The returned values fill the draft fields; nothing is written until you apply the change." ] },
      ] },
      { id: "gps-limits", title: "GPS limits", blocks: [
        { type: "list", items: ["GPS editing is for supported still image layouts; video remains preview-only.", "A location name is descriptive text and does not set coordinates.", "A saved Metadata Profile stores a descriptive location name only. My Projects can store project GPS coordinates for eligible Premium users.", "Bulk GPS writing is Premium by default. Pure GPS removal under a cleaning action is not affected by that feature gate." ] },
      ] },
    ],
  },
  {
    slug: "downloads-reports",
    title: "Downloads and audit reports",
    description: "Download one verified result, bundle eligible outputs as a ZIP, and export CSV or PDF reports.",
    category: "Files and downloads",
    related: ["clean-metadata", "bulk-cleaning", "privacy-security", "supported-formats"],
    searchTerms: ["download", "CSV", "PDF", "tag ledger", "audit reports", "ZIP", "report options"],
    sections: [
      { id: "single-download", title: "Download one result", blocks: [
        { type: "paragraph", text: "After cleaning or rewriting finishes, use the download control on the result panel or queue row. The output is a separate file; the source file is not overwritten. A Partial result is labeled and includes its warning with the download action." },
      ] },
      { id: "zip-download", title: "Download results as a ZIP", blocks: [
        { type: "steps", items: [
          { title: "Finish processing", text: "The ZIP includes eligible completed outputs, not original files that have no result." },
          { title: "Review partial files", text: "Partial outputs are excluded by default. Select Include partial outputs in ZIP only if you have reviewed the per-file warnings." },
          { title: "Choose report options", text: "Open Report options and choose None, CSV, PDF, or CSV + PDF for reports included in the ZIP." },
          { title: "Create the archive", text: "Select Download ZIP. If adding reports fails, the app may offer Download ZIP without reports. Very large ZIP runs are refused at the configured safety limit." },
        ] },
        { type: "image", src: "/help-screenshots/reports.jpg", alt: "Audit reports panel with CSV and PDF downloads and report options", caption: "Report controls shown with synthetic local test data; original metadata values are hidden by default." },
      ] },
      { id: "csv-pdf", title: "Export CSV and PDF", blocks: [
        { type: "list", items: ["Download CSV exports the report snapshot as a spreadsheet-friendly file.", "Download PDF exports a frozen report snapshot for sharing or printing.", "Detailed (+ tag ledger) adds the Download tag ledger option with per-tag detail.", "By default, original metadata values are hidden. Turning on Include original metadata values may expose coordinates, names, dates, serial numbers, or prompt text.", "Reports include each queued file and its inspection and processing status, including failure and verification information where available." ] },
        { type: "callout", tone: "warning", title: "Review before sharing", text: "A report can contain sensitive file names, metadata, or coordinates if you opt to include original values. Review the report before sending it to another person." },
      ] },
    ],
  },
  {
    slug: "account-profile",
    title: "Google sign-in and Metadata Profile",
    description: "Sign in, save reusable metadata fields, apply them during rewriting, and understand what account data is stored.",
    category: "Account and Premium",
    related: ["rewrite-metadata", "projects-premium", "privacy-security", "gps-location"],
    searchTerms: ["Google sign-in", "Metadata Profile", "Save profile", "Firestore", "account", "sign out", "preferences"],
    sections: [
      { id: "sign-in", title: "Sign in with Google", blocks: [
        { type: "steps", items: [
          { title: "Open Profile", text: "Use Profile in the site navigation. Select Continue with Google and complete the provider sign-in flow." },
          { title: "Review account status", text: "The page shows your connected Google account and the available profile sections. If sign-in is unavailable, guest cleaning and one-image custom rewriting remain available on the workspace." },
          { title: "Sign out", text: "Use the account summary sign-out control when finished on a shared device." },
        ] },
      ] },
      { id: "save-profile", title: "Save and apply a Metadata Profile", blocks: [
        { type: "steps", items: [
          { title: "Enter reusable details", text: "In Metadata Profile, enter the supported company, creator, copyright, rights, website, contact, title, description, keyword, or descriptive location values that you want to reuse." },
          { title: "Save the profile", text: "Select Save profile and review the saved profile preview. Profile values are not automatically copied from your Google account." },
          { title: "Apply values to an image", text: "In the workspace, choose Edit for one supported image and open Preset & Profile. Select the saved profile as a source, then preview and apply the values." },
          { title: "Update or delete", text: "Return to Metadata Profile to edit and save changes, clear the form, or use Delete profile and confirm. Previously downloaded outputs are not changed." },
        ] },
      ] },
      { id: "stored-data", title: "What is saved", blocks: [
        { type: "table", headers: ["Data", "Where it is stored"], rows: [
          ["Selected media bytes and processing results", "In browser memory for the current workspace; not uploaded to the app server."],
          ["Saved Metadata Profile and My Projects", "Cloud Firestore in your signed-in account."],
          ["Google sign-in identity and account details", "Firebase Authentication and the app's account services."],
          ["Rewrite Preferences", "In browser-local storage on that device and browser; they are not a cloud profile."],
        ] },
      ] },
      { id: "rewrite-preferences", title: "Set Rewrite Preferences", blocks: [
        { type: "steps", items: [
          { title: "Open Rewrite Preferences", text: "On Profile, choose Rewrite Preferences. These settings are saved in this browser, not in your cloud Metadata Profile." },
          { title: "Choose a mode", text: "Replace editable metadata and apply my profile (default) cleans removable non-technical metadata before writing checked fields. Update only selected fields changes checked fields and can leave unrelated metadata, including GPS, AI, or provenance data." },
          { title: "Choose fields", text: "Under Fields to apply, check the values from your saved profile that should be written. The profile needs at least one valid value and at least one selected field." },
          { title: "Apply from the workspace", text: "Select eligible files, then use Apply profile to selected (n) or Apply profile to all eligible (n). Applying a saved profile requires sign-in; multi-file rewriting is Premium by default." },
        ] },
        { type: "callout", tone: "warning", title: "Preferences do not change old outputs", text: "A preference controls future profile applications from this browser. It does not update your saved profile or any file that was already downloaded." },
      ] },
    ],
  },
  {
    slug: "projects-premium",
    title: "Premium projects and access",
    description: "Compare current free and Premium-by-default features, create project presets, and apply project metadata to rewrites.",
    category: "Account and Premium",
    related: ["account-profile", "rewrite-metadata", "gps-location", "bulk-cleaning"],
    searchTerms: ["Premium", "My Projects", "project title", "Client Name", "duplicate title", "batch rewrite", "feature access"],
    sections: [
      { id: "access-table", title: "Current access overview", blocks: [
        { type: "table", headers: ["Capability", "Current default access"], rows: [
          ["Inspect supported files", "Guest access"],
          ["Clean one or many supported files; create ZIP and reports", "Currently included in guest access"],
          ["Rewrite one image with custom values", "Guest access; no saved profile required"],
          ["Save and apply one Metadata Profile", "Sign-in required"],
          ["Rewrite multiple images in one batch", "Premium access required by default; check current availability in the workspace"],
          ["Create or manage multiple named projects", "Premium access required by default; check current availability in the workspace"],
          ["Apply a saved project or write GPS to multiple images", "Premium access required by default; check current availability in the workspace"],
        ] },
        { type: "callout", tone: "note", title: "No public checkout", text: "The app does not currently provide an in-app subscription checkout or price list. Ask the person who provided your app access about Premium availability." },
      ] },
      { id: "create-project", title: "Create a project preset", blocks: [
        { type: "steps", items: [
          { title: "Sign in and open My Projects", text: "On the Profile page, select My Projects. Creating and editing multiple projects requires Premium access by default." },
          { title: "Start a project", text: "Select Create project and enter a unique Project Title. Client Name is optional and labels the client for your own project list." },
          { title: "Enter reusable metadata", text: "Add the supported company, creator, rights, website, contact, title, description, keywords, location name, and optional Latitude, Longitude, and Altitude values." },
          { title: "Save and use it", text: "Select Create project. On a rewrite, open Edit metadata → Preset & Profile and choose the project from Select a project… . Review the field preview before applying." },
        ] },
      ] },
      { id: "manage-project", title: "Edit, duplicate, rename, or delete", blocks: [
        { type: "paragraph", text: "Use the project card controls to edit a project, duplicate it, or delete it after confirming. Project Title must be unique after normalization; if another project already uses that title, rename the project and save again. Deleting a project does not change files already downloaded." },
        { type: "list", items: ["The project name identifies the preset; the Image Title field is the value written into image metadata.", "Project-specific values can be reviewed and overridden for an individual image before rewrite.", "If Premium access ends, existing projects can remain visible for review and deletion; creating or editing may be unavailable until access returns." ] },
      ] },
    ],
  },
  {
    slug: "privacy-security",
    title: "Privacy and account data",
    description: "Learn what stays in the browser, what account features store, and what optional external location services receive.",
    category: "Privacy and security",
    related: ["quick-start", "account-profile", "gps-location", "downloads-reports"],
    searchTerms: ["privacy", "security", "upload", "Firebase", "Firestore", "data", "local storage", "network", "Nominatim", "map"],
    sections: [
      { id: "media-processing", title: "Media processing stays in your browser", blocks: [
        { type: "paragraph", text: "The app processes selected image bytes in the browser. It does not upload media files to the app server. Cleaning and rewriting create a separate output in the browser, and verification re-reads that output before offering a download." },
        { type: "list", items: ["The source file remains unchanged at its original location.", "Files and outputs live in browser memory while the page is open; clearing the queue discards the in-app copies and results.", "Static hosting serves the web application and its assets; it is not a media-processing backend." ] },
      ] },
      { id: "account-storage", title: "Account features and browser storage", blocks: [
        { type: "paragraph", text: "If you use Google sign-in, Firebase Authentication handles the sign-in identity. Cloud Firestore stores saved profile and project information and account access records. Saved profiles and projects do not contain uploaded image bytes." },
        { type: "paragraph", text: "Rewrite Preferences are stored in local browser storage on the device and browser where you set them. Some features may require sign-in or Premium access." },
      ] },
      { id: "optional-services", title: "Optional location services", blocks: [
        { type: "list", items: ["The map loads only after you opt in; map tile requests are sent to the displayed map provider.", "Place search sends the query you submit to Nominatim. The provider receives your network address as part of the request. Your media bytes, filename, and metadata are not sent with that query.", "Use my current location asks the browser for permission after you click it. Coordinates populate a draft only; they are not written until you apply the operation." ] },
        { type: "callout", tone: "note", title: "Choose manual coordinates for offline use", text: "The GPS coordinate fields work without loading a map or searching a place name." },
      ] },
      { id: "limits", title: "Security and usage limits", blocks: [
        { type: "list", items: ["Browser memory and device performance can limit very large files or queues.", "Reports are generated locally, but can contain sensitive values if you opt in to including originals.", "A valid-looking output does not guarantee removal of unknown proprietary metadata; read verification and coverage warnings.", "Use a trusted, up-to-date browser and avoid sharing the device while sensitive files remain in an open workspace." ] },
      ] },
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description: "Resolve common upload, preview, inspection, cleaning, rewriting, sign-in, Premium, and download problems.",
    category: "Help",
    related: ["supported-formats", "clean-metadata", "rewrite-metadata", "account-profile", "downloads-reports"],
    searchTerms: ["error", "failed", "unsupported", "preview", "browser memory", "Google Sign-In", "Premium access", "ZIP too large", "verification"],
    sections: [
      { id: "file-issues", title: "File or preview problems", blocks: [
        { type: "table", headers: ["What you see", "Why it may happen / what to try"], rows: [
          ["The file is unsupported", "The bytes may not match a supported still-image layout, or the file may be video. Confirm the actual format and use a supported copy. Video is preview-only."],
          ["An image does not preview", "HEIC/HEIF and some browser/codec combinations cannot display inline. A missing preview does not by itself mean metadata inspection failed."],
          ["Animated WebP is refused", "Animated WebP is outside the verified cleaning path. Use a still image copy if you have one; do not convert the source through an untrusted service for private files."],
          ["Inspection is partial or fails", "The metadata may be malformed, truncated, unsupported, or too large for available browser memory. Review details and warnings; retry with a known-good local copy if appropriate."],
        ] },
      ] },
      { id: "operation-issues", title: "Cleaning or rewriting problems", blocks: [
        { type: "table", headers: ["What you see", "What to do"], rows: [
          ["Failed, not verified, or unsupported result", "Do not treat it as a successful clean. The source stays unchanged. Try a supported file layout or keep the original."],
          ["Partial result", "Read the retained-data notes. Download only if the disclosed partial result meets your needs; partial ZIP inclusion is off by default."],
          ["Rewrite is disabled", "Check that at least one valid, supported value is entered and one field is selected. Some fields or channels are unsupported for that format."],
          ["Batch rewrite or project access is locked", "These features require Premium access by default. Check your account status or ask the person who provided your app access about availability."],
          ["GPS Apply is unavailable", "Check coordinate ranges, the file format, and that a supported still image is selected. Map loading is optional; manual coordinates remain available."],
        ] },
      ] },
      { id: "account-download-issues", title: "Account and download problems", blocks: [
        { type: "table", headers: ["What you see", "What to try"], rows: [
          ["Google sign-in does not return to the app", "Retry in a browser that allows the sign-in flow, check that cookies/pop-ups are not blocked for the provider, and reload the Profile page. Guest cleaning remains available."],
          ["Profile save permission error", "Confirm you are signed into the expected Google account and that the account is active. Reload and try again; do not create another account to bypass a restriction."],
          ["ZIP creation fails", "Try fewer or smaller files. A safety size limit can reject an archive. If reports cause the failure, use Download ZIP without reports when offered."],
          ["Download did not appear", "Check the browser download list and confirm that a verified output exists. Keep the workspace open until the download starts."],
        ] },
        { type: "callout", tone: "warning", title: "Do not disable browser protections", text: "If a file cannot be safely inspected or processed, keep the original. Do not disable security settings or upload private media to an unrelated service as a default workaround." },
      ] },
    ],
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    description: "Clear answers about free access, privacy, supported formats, AI evidence, GPS, reports, and Premium features.",
    category: "Help",
    related: ["quick-start", "supported-formats", "privacy-security", "projects-premium", "troubleshooting"],
    searchTerms: ["free", "account", "quality", "AI", "GPS", "SEO", "video", "Premium", "original files"],
    sections: [
      { id: "access-and-privacy", title: "Access and privacy", blocks: [
        { type: "table", headers: ["Question", "Answer"], rows: [
          ["Is the app free?", "Guests can inspect files, clean one or many supported files, download ZIPs, and export reports. A single-image custom rewrite is also available without saving a profile. Some batch and project features are Premium by default."],
          ["Do I need an account?", "No for guest inspection, cleaning, ZIP downloads, reports, or one-image custom rewriting. Sign in to save or apply a Metadata Profile and to access account features."],
          ["Are my images uploaded?", "No. Selected media bytes are processed locally in the browser. Sign-in/account features and optional location services make separate network requests."],
          ["What happens to the original file?", "The app creates a separate output and does not overwrite the original source file."],
          ["What is stored in my profile?", "Metadata values you save, project presets, and account-related records are stored in Firebase. The media file itself is not stored there."],
        ] },
      ] },
      { id: "metadata-and-quality", title: "Metadata, AI, and quality", blocks: [
        { type: "table", headers: ["Question", "Answer"], rows: [
          ["Can it prove an image was AI-generated?", "No. The app checks supported metadata evidence, not pixels, and cannot prove authorship or generation method."],
          ["Does cleaning reduce image quality?", "The image payload is preserved for supported cleaning paths; the app does not use a canvas re-encode fallback. Unsupported structures can be refused."],
          ["Can I remove GPS or write GPS?", "Yes, on supported still image layouts. Use Edit → Location (GPS). A descriptive Location Name alone does not change coordinates."],
          ["Can I use metadata for SEO?", "You can write supported descriptive values such as title, description, creator, keywords, website, and location name. Search engines may ignore or interpret embedded metadata differently; the app does not promise ranking results."],
        ] },
      ] },
      { id: "formats-and-features", title: "Formats and features", blocks: [
        { type: "table", headers: ["Question", "Answer"], rows: [
          ["Which formats are supported?", "JPEG/JPG, PNG, WebP, AVIF, and supported HEIC/HEIF still layouts. MP4, MOV, and WebM are preview-only. See Supported formats for exact limitations."],
          ["Can I clean video?", "No. MP4, MOV, and WebM can be previewed only; their metadata is not inspected, cleaned, or rewritten."],
          ["Can I process multiple files?", "Bulk cleaning is free by default. Batch rewriting and bulk GPS writing are separate Premium-by-default operations."],
          ["Can I export PDF reports?", "Yes. Select Download PDF in Audit reports. Report values are hidden by default; review privacy options before sharing."],
          ["Is there a payment checkout?", "There is no in-app subscription checkout or price list at this time. Ask the person who provided your app access about Premium availability."],
          ["What happens if verification fails?", "The app withholds a verified-success claim. The source remains unchanged; use the status and warnings and do not treat it as a successful clean."],
        ] },
      ] },
    ],
  },
  {
    slug: "changelog",
    title: "Release notes",
    description: "User-facing documentation and product behavior updates confirmed for the current release.",
    category: "Help",
    related: ["quick-start", "supported-formats", "troubleshooting"],
    searchTerms: ["changelog", "release notes", "November 2026", "documentation"],
    sections: [
      { id: "2026-11-04", title: "Documentation release — November 4, 2026", blocks: [
        { type: "paragraph", text: "Added a public, workflow-based help center for Private Metadata Cleaner, with guides for supported formats, inspection, cleaning, rewriting, GPS, downloads, reports, accounts, projects, privacy, and troubleshooting." },
        { type: "paragraph", text: "Updated product help copy to point users to the working GPS editor and to state current image, video-preview, and rewrite behavior more accurately. Audio documentation is intentionally deferred while MP3 support is being completed. This release changes documentation and help text only; media processing behavior is unchanged." },
      ] },
    ],
  },
];

export function getDocArticle(slug: string): DocArticle | undefined {
  return DOC_ARTICLES.find((article) => article.slug === slug);
}

export function docSearchText(article: DocArticle): string {
  return [
    article.title,
    article.description,
    article.category,
    ...(article.searchTerms ?? []),
    ...article.sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap((block) => {
        if (block.type === "paragraph" || block.type === "callout") return [block.text, block.type === "callout" ? block.title : ""];
        if (block.type === "list") return block.items;
        if (block.type === "steps") return block.items.flatMap((item) => [item.title, item.text]);
        if (block.type === "table") return [...block.headers, ...block.rows.flat()];
        return [block.alt, block.caption];
      }),
    ]),
  ].join(" ").toLocaleLowerCase();
}
