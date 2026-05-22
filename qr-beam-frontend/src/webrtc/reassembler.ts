/**
 * File reassembler — receives encrypted chunks over WebRTC DataChannel,
 * buffers them in IndexedDB, reassembles, verifies SHA-256, triggers download.
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

export function startReassembler(
  channel: RTCDataChannel,
  key: CryptoKey,
  callbacks: ReassemblerCallbacks
): () => void {
  let meta: FileMetadata | null = null;
  let receivedChunks = 0;
  const sessionKey = `${IDB_PREFIX}${Date.now()}`;
  const { onMetadata, onProgress, onDone, onError } = callbacks;

  const handleMessage = async (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) return;

    try {
      const frame = decodeFrame(event.data);

      if (frame.type === FrameType.METADATA) {
        const metaJson = await decryptChunk(key, frame.iv, frame.ciphertext);
        meta = JSON.parse(new TextDecoder().decode(metaJson)) as FileMetadata;

        const accepted = onMetadata ? await onMetadata(meta) : true;
        const responseType = accepted ? 0x06 : 0x07;
        const emptyIv = new Uint8Array(12);
        channel.send(encodeFrame(responseType as typeof FrameType.ACCEPT, 0, emptyIv, new Uint8Array(0)));

        if (!accepted) meta = null;
        return;
      }

      if (frame.type === FrameType.CHUNK && meta) {
        const adBytes = new Uint8Array(4);
        new DataView(adBytes.buffer).setUint32(0, frame.chunkIndex, false);
        const plaintext = await decryptChunk(key, frame.iv, frame.ciphertext, adBytes);
        await set(`${sessionKey}_${frame.chunkIndex}`, plaintext);
        receivedChunks++;
        onProgress?.(receivedChunks, meta.totalChunks);
        return;
      }

      if (frame.type === FrameType.DONE && meta) {
        const parts: Uint8Array[] = [];
        for (let i = 0; i < meta.totalChunks; i++) {
          const chunk = await get<Uint8Array>(`${sessionKey}_${i}`);
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

        const computedHash = await sha256Hex(fullData);
        if (computedHash !== meta.sha256) {
          throw new Error(`SHA-256 mismatch! File integrity check failed.`);
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

        for (let i = 0; i < meta.totalChunks; i++) {
          await del(`${sessionKey}_${i}`);
        }

        onDone?.(meta.filename, meta.mimeType);
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
  return () => channel.removeEventListener('message', handleMessage);
}
