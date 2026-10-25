// SPDX-License-Identifier: AGPL-3.0-only
// Where verified exports end up. With the File System Access API the bytes stream to disk and
// the file is only committed (closed) after the completion check; abort() discards the swap file.
// Otherwise the bytes are collected in memory (hard client limit) and offered as a download
// after verification.
import { t } from '$lib/i18n';
import { ExportError, type ExportSink } from './run';

/** Client-side cap for the in-memory fallback. */
export const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

export interface SaveDeps {
  /** Hands a finished file to the user; defaults to an object URL download. */
  deliver?: (blob: Blob, filename: string) => void;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export class MemorySink implements ExportSink {
  private chunks: Uint8Array[] = [];
  private size = 0;
  constructor(
    private mime: string,
    private deps: SaveDeps = {},
    private limit = MEMORY_LIMIT_BYTES,
  ) {}
  async write(chunk: Uint8Array) {
    this.size += chunk.length;
    if (this.size > this.limit)
      throw new ExportError('client_limit', 'client_limit', t('exportDump.err.memoryLimit'));
    this.chunks.push(chunk);
  }
  async commit(filename: string) {
    const blob = new Blob(this.chunks as BlobPart[], { type: this.mime });
    this.chunks = [];
    (this.deps.deliver ?? downloadBlob)(blob, filename);
  }
  async abort() {
    this.chunks = [];
    this.size = 0;
  }
}

interface WritableLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}

export class FileSystemSink implements ExportSink {
  private done = false;
  constructor(private writable: WritableLike) {}
  async write(chunk: Uint8Array) {
    await this.writable.write(chunk);
  }
  async commit() {
    this.done = true;
    await this.writable.close();
  }
  async abort() {
    if (this.done) return;
    this.done = true;
    await this.writable.abort().catch(() => undefined);
  }
}

export const supportsFileSystemAccess = () =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/**
 * Must be called from the click handler (user gesture), before the request starts.
 * Returns null when the user dismisses the file dialog.
 */
export async function openSink(suggestedName: string, mime: string): Promise<ExportSink | null> {
  if (supportsFileSystemAccess()) {
    try {
      const picker = (
        window as unknown as { showSaveFilePicker: (o: object) => Promise<FileHandleLike> }
      ).showSaveFilePicker;
      const handle = await picker.call(window, { suggestedName });
      return new FileSystemSink(await handle.createWritable());
    } catch (cause) {
      if ((cause as { name?: string } | null)?.name === 'AbortError') return null;
      // Any other failure: fall back to the memory path instead of losing the export.
    }
  }
  return new MemorySink(mime);
}
