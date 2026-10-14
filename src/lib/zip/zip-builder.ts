/**
 * Browser ZIP builder on fflate (MIT, zero dependencies), lazy-loaded so the
 * landing bundle stays lean (Phase 4).
 *
 * - STORE (no recompression) via ZipPassThrough: already-compressed images
 *   are copied, CRCs computed by the writer.
 * - Streaming: Blob entries are read and pushed in 256 KiB slices with UI
 *   yields and cancellation points. The Blob-download fallback still holds
 *   the finished archive in memory because browsers require it for download.
 * - Sinks: File System Access writable stream where available (explicit
 *   user gesture), otherwise an in-memory byte assembly for Blob download
 *   with an estimated-size warning path.
 * - No Zip64: archives are refused past 4 GiB rather than corrupted.
 */

export interface ZipSource {
  path: string;
  /** Blob sources are sliced lazily so a whole batch is never materialized. */
  data: Uint8Array | Blob;
}

export interface ZipProgress {
  filesDone: number;
  filesTotal: number;
  bytesWritten: number;
}

export class ZipBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipBuildError";
  }
}

export class ZipCancelled extends Error {
  constructor() {
    super("Archive writing cancelled; partial output discarded.");
    this.name = "ZipCancelled";
  }
}

const SLICE_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 0xffffffff;

type FflateModule = typeof import("fflate");

let fflatePromise: Promise<FflateModule> | null = null;

function loadFflate(): Promise<FflateModule> {
  if (!fflatePromise) fflatePromise = import("fflate");
  return fflatePromise;
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export interface ZipBuildOptions {
  onProgress?: (progress: ZipProgress) => void;
  isCancelled?: () => boolean;
  /** File System Access writable stream; when set, chunks stream to disk. */
  sink?: { write: (chunk: Uint8Array) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> };
}

function checkCancel(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new ZipCancelled();
}

/**
 * Build the archive. Returns assembled bytes when no sink is given (Blob
 * fallback path). Throws ZipBuildError (never a half-ready "success").
 */
export async function buildZipArchive(
  sources: ZipSource[],
  options: ZipBuildOptions = {},
): Promise<Uint8Array> {
  if (sources.length === 0) {
    throw new ZipBuildError("No eligible files to archive.");
  }
  const sourceSize = (source: ZipSource) => source.data instanceof Blob ? source.data.size : source.data.length;
  const estimated = sources.reduce((sum, source) => sum + sourceSize(source) + source.path.length * 2 + 1024, 0);
  if (estimated > MAX_ARCHIVE_BYTES) {
    throw new ZipBuildError("Estimated archive exceeds the 4 GiB non-Zip64 limit — split the batch instead of risking corruption.");
  }
  const { Zip, ZipPassThrough } = await loadFflate();
  const collected: Uint8Array[] = [];
  let collectedLength = 0;
  // File-system writes are chained strictly in order; the first failure is
  // captured and rethrown after the loop (never a half-ready "success").
  let writeChain = Promise.resolve();
  let writeError: unknown = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      writeError = error;
      return;
    }
    if (options.sink) {
      const sink = options.sink;
      writeChain = writeChain.then(() => sink.write(chunk)).catch((failure: unknown) => {
        writeError = failure;
      });
    } else {
      collected.push(chunk);
      collectedLength += chunk.length;
    }
  });
  let bytesWritten = 0;
  try {
    let filesDone = 0;
    for (const source of sources) {
      checkCancel(options.isCancelled);
      const entry = new ZipPassThrough(source.path);
      zip.add(entry);
      const dataLength = sourceSize(source);
      for (let offset = 0; offset < dataLength; offset += SLICE_BYTES) {
        checkCancel(options.isCancelled);
        const end = Math.min(offset + SLICE_BYTES, dataLength);
        const last = end >= dataLength;
        const chunk = source.data instanceof Blob
          ? new Uint8Array(await source.data.slice(offset, end).arrayBuffer())
          : source.data.subarray(offset, end);
        entry.push(chunk, last);
        bytesWritten += end - offset;
        await yieldToUi();
      }
      if (dataLength === 0) {
        entry.push(new Uint8Array(0), true);
      }
      filesDone += 1;
      options.onProgress?.({ filesDone, filesTotal: sources.length, bytesWritten });
      await yieldToUi();
    }
    zip.end();
    await writeChain;
    if (writeError) {
      throw new ZipBuildError(writeError instanceof Error ? writeError.message.slice(0, 300) : "Archive sink write failed.");
    }
    if (options.sink) {
      await options.sink.close();
      return new Uint8Array(0);
    }
    const out = new Uint8Array(collectedLength);
    let cursor = 0;
    for (const chunk of collected) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  } catch (error) {
    if (options.sink) {
      try {
        await options.sink.abort?.();
      } catch {
        // Abort is best-effort; the original error carries the meaning.
      }
    }
    if (error instanceof ZipCancelled) throw error;
    if (error instanceof ZipBuildError) throw error;
    throw new ZipBuildError(error instanceof Error ? error.message.slice(0, 300) : "Unknown archive failure.");
  }
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}
