/**
 * Local download helper (Phase 5): click-scoped object URLs, always revoked.
 * Works for CSV text, PDF bytes and ZIP archives alike. Nothing uploaded.
 */
export function downloadNamedBlob(data: Uint8Array | string, fileName: string, mimeType: string): void {
  const part: BlobPart = typeof data === "string"
    ? data
    : data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data.buffer as ArrayBuffer
      : data.slice().buffer as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([part], { type: mimeType }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

export function reportFileName(kind: "csv" | "tags" | "pdf", when: Date = new Date()): string {
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  switch (kind) {
    case "csv":
      return `metadata-report-${stamp}.csv`;
    case "tags":
      return `metadata-tags-${stamp}.csv`;
    case "pdf":
      return `metadata-report-${stamp}.pdf`;
  }
}
