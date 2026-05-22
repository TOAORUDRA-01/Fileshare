/**
 * Binary frame protocol for WebRTC DataChannel messages.
 *
 * Frame format:
 * [1B  frame_type]  — message type enum
 * [4B  chunk_index] — uint32 big-endian (0 for METADATA/DONE/ERROR)
 * [12B iv]          — AES-GCM IV (96 bits)
 * [4B  payload_len] — uint32 big-endian length of ciphertext
 * [N   ciphertext]  — AES-256-GCM encrypted payload (with 16B auth tag)
 *
 * Total overhead per frame: 21 bytes
 */

export const FrameType = {
  METADATA: 0x01,
  CHUNK:    0x02,
  ACK:      0x03,
  DONE:     0x04,
  ERROR:    0x05,
  ACCEPT:   0x06,
  REJECT:   0x07,
} as const;

export type FrameTypeValue = typeof FrameType[keyof typeof FrameType];

export const FRAME_HEADER_SIZE = 1 + 4 + 12 + 4; // 21 bytes

/** Encode a frame into a single ArrayBuffer ready for DataChannel.send(). */
export function encodeFrame(
  type: FrameTypeValue,
  chunkIndex: number,
  iv: Uint8Array,    // 12 bytes
  ciphertext: Uint8Array
): ArrayBuffer {
  const total = FRAME_HEADER_SIZE + ciphertext.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  view.setUint8(0, type);
  view.setUint32(1, chunkIndex, false);
  u8.set(iv, 5);               // offset 5, 12 bytes
  view.setUint32(17, ciphertext.length, false);
  u8.set(ciphertext, 21);

  return buf;
}

export interface DecodedFrame {
  type: FrameTypeValue;
  chunkIndex: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/** Decode a received ArrayBuffer into a typed frame. Throws if malformed. */
export function decodeFrame(buf: ArrayBuffer): DecodedFrame {
  if (buf.byteLength < FRAME_HEADER_SIZE) {
    throw new Error(`Frame too small: ${buf.byteLength} bytes`);
  }
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  const type = view.getUint8(0) as FrameTypeValue;
  const chunkIndex = view.getUint32(1, false);
  const iv = u8.slice(5, 17);
  const payloadLen = view.getUint32(17, false);

  if (buf.byteLength < FRAME_HEADER_SIZE + payloadLen) {
    throw new Error(`Frame payload truncated: expected ${payloadLen}, got ${buf.byteLength - FRAME_HEADER_SIZE}`);
  }

  const ciphertext = u8.slice(21, 21 + payloadLen);
  return { type, chunkIndex, iv, ciphertext };
}

/** Metadata payload structure (JSON, then encrypted). */
export interface FileMetadata {
  filename: string;
  size: number;       // bytes
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  sha256: string;     // hex SHA-256 of plaintext file, empty when full-file hashing is disabled
  integrity?: 'aes-gcm-per-chunk';
}
