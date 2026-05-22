/**
 * File chunker with AES-256-GCM per-chunk encryption and flow control.
 */

import { encryptChunk, sha256File } from '../crypto/aes';
import { encodeFrame, FrameType } from './protocol';
import type { FileMetadata } from './protocol';

export const CHUNK_SIZE = 65_536; // 64 KB
const HIGH_WATERMARK = 16 * 1024 * 1024;
const LOW_WATERMARK  =  4 * 1024 * 1024;

export interface ChunkProgress {
  sentChunks: number;
  totalChunks: number;
  bytesSent: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
}

export interface ChunkerCallbacks {
  onProgress?: (p: ChunkProgress) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export async function sendFile(
  file: File,
  key: CryptoKey,
  channel: RTCDataChannel,
  callbacks: ChunkerCallbacks = {}
): Promise<void> {
  const { onProgress, onDone } = callbacks;

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const sha256 = await sha256File(file);

  const meta: FileMetadata = {
    filename: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    totalChunks,
    chunkSize: CHUNK_SIZE,
    sha256,
  };
  const metaJson = new TextEncoder().encode(JSON.stringify(meta));
  const { iv: metaIv, ciphertext: metaCt } = await encryptChunk(key, metaJson);
  channel.send(encodeFrame(FrameType.METADATA, 0, metaIv, metaCt));

  await waitForAccept(channel);

  let offset = 0;
  let chunkIndex = 0;
  const startTime = Date.now();

  while (offset < file.size) {
    while (channel.bufferedAmount > HIGH_WATERMARK) {
      await new Promise<void>((r) => {
        const handler = () => {
          if (channel.bufferedAmount < LOW_WATERMARK) {
            channel.removeEventListener('bufferedamountlow', handler);
            r();
          }
        };
        channel.bufferedAmountLowThreshold = LOW_WATERMARK;
        channel.addEventListener('bufferedamountlow', handler);
        setTimeout(r, 500);
      });
    }

    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const slice = await file.slice(offset, end).arrayBuffer();
    const plaintext = new Uint8Array(slice);

    const adBytes = new Uint8Array(4);
    new DataView(adBytes.buffer).setUint32(0, chunkIndex, false);
    const { iv, ciphertext } = await encryptChunk(key, plaintext, adBytes);

    channel.send(encodeFrame(FrameType.CHUNK, chunkIndex, iv, ciphertext));

    offset += CHUNK_SIZE;
    chunkIndex++;

    if (onProgress) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speedBps = elapsed > 0 ? (Math.min(offset, file.size) / elapsed) : 0;
      const remaining = file.size - Math.min(offset, file.size);
      const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;
      onProgress({
        sentChunks: chunkIndex,
        totalChunks,
        bytesSent: Math.min(offset, file.size),
        totalBytes: file.size,
        speedBps,
        etaSeconds
      });
    }
  }

  const doneIv = new Uint8Array(12);
  channel.send(encodeFrame(FrameType.DONE, totalChunks, doneIv, new Uint8Array(0)));
  onDone?.();
}

function waitForAccept(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Receiver did not respond to transfer request')), 30_000);

    const handler = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const view = new DataView(event.data);
      const type = view.getUint8(0);
      if (type === 0x06) {
        clearTimeout(timeout);
        channel.removeEventListener('message', handler);
        resolve();
      } else if (type === 0x07) {
        clearTimeout(timeout);
        channel.removeEventListener('message', handler);
        reject(new Error('Receiver declined the file transfer'));
      }
    };
    channel.addEventListener('message', handler);
  });
}
