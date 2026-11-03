"use client";

import { useRef } from "react";
import { PICKER_ACCEPT } from "../upload/UploadPanel";

interface QueueToolbarProps {
  allSelected: boolean;
  busy: boolean;
  selectedCount: number;
  selectedUnsupportedCount: number;
  workCount: number;
  onToggleSelectAll: () => void;
  onChooseFiles: (files: File[]) => void;
  onRemoveSelected: () => void;
  onClear: () => void;
  onCancelWork: () => void;
}

/**
 * Screen 04 list toolbar. Compact single row above the file table:
 * "Select all" + dynamic selection badge on the left; the preserved
 * queue-management controls (add, remove selected, clear) stay available
 * as restrained buttons on the right, per the implementation brief.
 * The three removal actions live in the workspace card header; this bar
 * keeps the accessible picker input for "Add more files".
 */
export default function QueueToolbar({
  allSelected,
  busy,
  selectedCount,
  selectedUnsupportedCount,
  workCount,
  onToggleSelectAll,
  onChooseFiles,
  onRemoveSelected,
  onClear,
  onCancelWork,
}: QueueToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = (list: FileList | null | undefined) => {
    if (!list || list.length === 0) return;
    onChooseFiles(Array.from(list));
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#edf1f7] px-4 py-3 sm:px-5"
      data-testid="queue-toolbar"
    >
      {/* Same private picker contract as the landing uploader: explicit
          accept list, multi-select, reset after choice, never a wildcard. */}
      <input
        id="private-media-picker"
        ref={inputRef}
        type="file"
        multiple
        accept={PICKER_ACCEPT}
        data-testid="file-input"
        className="sr-only"
        tabIndex={-1}
        aria-label="Add more files to the workspace"
        onChange={(event) => {
          emit(event.target.files);
          event.target.value = "";
        }}
      />

      <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 text-[13.5px] font-bold text-[#1c2a4a] hover:bg-slate-50">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleSelectAll}
          aria-label="Select all files"
          className="h-[1.15rem] w-[1.15rem] cursor-pointer accent-[#0d9474]"
        />
        Select all
      </label>
      <span className="rounded-full bg-slate-100 px-2.5 py-1.5 text-[11.5px] font-bold text-slate-600">
        {selectedCount} selected file{selectedCount === 1 ? "" : "s"}
      </span>
      {selectedUnsupportedCount > 0 ? (
        <span className="rounded-full bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-bold text-amber-800">
          {selectedUnsupportedCount} review-only
        </span>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {workCount > 0 ? (
          <button
            type="button"
            onClick={onCancelWork}
            data-testid="inspect-cancel"
            className="btn-secondary !min-h-8 !border-amber-200 !bg-amber-50 !px-2.5 !py-1 text-[11.5px] !text-amber-800"
          >
            Cancel work ({workCount})
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="upload-choose"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold text-[#2d5be9] hover:bg-[#f2f6ff] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9]"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15.5V4.5m0 0L7.8 8.7M12 4.5l4.2 4.2M4.5 14.5v3.2a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3v-3.2" />
          </svg>
          Add files
        </button>
        <button
          type="button"
          onClick={onRemoveSelected}
          disabled={selectedCount === 0 || busy}
          title={selectedCount === 0 ? "Select at least one file to remove it from the queue." : `Remove ${selectedCount} selected file${selectedCount === 1 ? "" : "s"} from the queue.`}
          className="btn-secondary !min-h-8 !px-2.5 !py-1 text-[11.5px]"
        >
          Remove selected
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          data-testid="queue-clear"
          title="Remove every file from the queue. Cleaned outputs are discarded too."
          className="btn-secondary !min-h-8 !px-2.5 !py-1 text-[11.5px]"
        >
          Clear queue
        </button>
      </div>
    </div>
  );
}
