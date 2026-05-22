/**
 * File reassembler for encrypted WebRTC DataChannel chunks.
 *
 * Normal transfers are assembled in memory for speed. Very large transfers use
 * IndexedDB as a pressure-release path so the tab does not have to retain every
 * decrypted chunk in JS heap at once.
 */

import { set, get, del } from 'idb-keyval';
import { decryptChunk, sha256Hex } from '../crypto/aes';
import { decodeFrame, encodeFrame, FrameType } from './protocol';
import type { FileMetadata } from './protocol';

export interface ReassemblerCallbacks {
  onMetadata?: (meta: FileMetadata) => Promise<boolean>;
  onProgress?: (received: number, total: number) => void;
  onDone?: (filename: string, mimeType: string) => void;
  onError?: (err: Error) => void;
}

const IDB_PREFIX = 'qrbeam_chunk_';
const MEMORY_BUFFER_LIMIT = 512 * 1024 * 1024;

export function startReassembler(
  channel: RTCDataChannel,
  key: CryptoKey,
  callbacks: ReassemblerCallbacks
): () => void {
  let meta: FileMetadata | null = null;
  let receivedChunks = 0;
  let doneSeen = false;
  let finalizing = false;
  let useIndexedDb = false;
  let memoryChunks: Array<Uint8Array | undefined> = [];
  const receivedIndexes = new Set<number>();
  const sessionKey = `${IDB_PREFIX}${Date.now()}`;
  const { onMetadata, onProgress, onDone, onError } = callbacks;

  const cleanupStoredChunks = async () => {
    if (!meta || !useIndexedDb) return;
    await Promise.all(
      Array.from(receivedIndexes, (chunkIndex) => del(`${sessionKey}_${chunkIndex}`))
    );
  };

  const finalizeTransfer = async () => {
    if (!meta || finalizing || !doneSeen || receivedChunks < meta.totalChunks) return;
    finalizing = true;

    const parts: Uint8Array[] = [];
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunk = useIndexedDb
        ? await get<Uint8Array>(`${sessionKey}_${i}`)
        : memoryChunks[i];
      if (!chunk) throw new Error(`Missing chunk ${i} of ${meta.totalChunks}`);
      parts.push(chunk);
    }

    const totalSize = parts.reduce((s, p) => s + p.length, 0);
    const fullData = new Uint8Array(totalSize);
    let offset = 0;
    for (const part of parts) {
      fullData.set(part, offset);
      offset += part.length;
    }

    if (meta.sha256) {
      const computedHash = await sha256Hex(fullData);
      if (computedHash !== meta.sha256) {
        throw new Error('SHA-256 mismatch! File integrity check failed.');
      }
    }

    const blob = new Blob([fullData], { type: meta.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await cleanupStoredChunks();
    memoryChunks = [];

    onDone?.(meta.filename, meta.mimeType);
  };

  const handleMessage = async (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) return;

    try {
      const frame = decodeFrame(event.data);

      if (frame.type === FrameType.METADATA) {
        const metaJson = await decryptChunk(key, frame.iv, frame.ciphertext);
        meta = JSON.parse(new TextDecoder().decode(metaJson)) as FileMetadata;
        useIndexedDb = meta.size > MEMORY_BUFFER_LIMIT;
        memoryChunks = useIndexedDb ? [] : new Array(meta.totalChunks);
        receivedIndexes.clear();
        receivedChunks = 0;
        doneSeen = false;
        finalizing = false;

        const accepted = onMetadata ? await onMetadata(meta) : true;
        const responseType = accepted ? FrameType.ACCEPT : FrameType.REJECT;
        const emptyIv = new Uint8Array(12);
        channel.send(encodeFrame(responseType, 0, emptyIv, new Uint8Array(0)));

        if (!accepted) meta = null;
        return;
      }

      if (frame.type === FrameType.CHUNK && meta) {
        const adBytes = new Uint8Array(4);
        new DataView(adBytes.buffer).setUint32(0, frame.chunkIndex, false);
        const plaintext = await decryptChunk(key, frame.iv, frame.ciphertext, adBytes);

        if (!receivedIndexes.has(frame.chunkIndex)) {
          if (useIndexedDb) {
            await set(`${sessionKey}_${frame.chunkIndex}`, plaintext);
          } else {
            memoryChunks[frame.chunkIndex] = plaintext;
          }
          receivedIndexes.add(frame.chunkIndex);
          receivedChunks++;
        }

        onProgress?.(receivedChunks, meta.totalChunks);
        await finalizeTransfer();
        return;
      }

      if (frame.type === FrameType.DONE && meta) {
        doneSeen = true;
        await finalizeTransfer();
        return;
      }

      if (frame.type === FrameType.ERROR) {
        onError?.(new Error('Sender reported an error during transfer'));
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  channel.addEventListener('message', handleMessage);
  return () => {
    channel.removeEventListener('message', handleMessage);
    void cleanupStoredChunks();
  };
}
