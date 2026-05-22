/**
 * QR Payload binary encoder.
 *
 * Binary layout (178 bytes total):
 * [2]  magic:      0x51 0x52  ("QR")
 * [1]  version:    0x01
 * [16] session_id: CSPRNG 128-bit
 * [65] sender_pub: ECDH P-256 uncompressed public key
 * [8]  timestamp:  Unix ms (uint64 big-endian)
 * [4]  ttl:        30000 ms (uint32 big-endian)
 * [50] sig_server: WSS URL (ASCII, null-padded)
 * [32] hmac:       HMAC-SHA256(all above, derived_secret)
 * Total: 178 bytes
 */

import QRCode from 'qrcode';
import { signPayload, deriveQRSecret } from '../crypto/hmac';

export const QR_MAGIC = new Uint8Array([0x51, 0x52]); // "QR"
export const QR_VERSION = 0x01;
export const QR_TTL_MS = 30_000; // 30 seconds TTL
export const QR_ROTATE_MS = 8_000; // rotate every 8 seconds
export const PAYLOAD_SIZE = 178;

export interface QRPayload {
  sessionId: Uint8Array; // 16 bytes
  senderPubKey: Uint8Array; // 65 bytes
  timestampMs: bigint;
  ttlMs: number;
  signalingUrl: string;
  hmac: Uint8Array; // 32 bytes
}

/** Build and sign a QR payload binary blob. */
export async function buildQRPayload(
  senderPubKey: Uint8Array,
  sessionId: Uint8Array,
  signalingUrl: string
): Promise<Uint8Array> {
  const timestampMs = BigInt(Date.now());
  const payload = new Uint8Array(PAYLOAD_SIZE);
  const view = new DataView(payload.buffer);

  let offset = 0;

  // magic [2]
  payload.set(QR_MAGIC, offset); offset += 2;
  // version [1]
  payload[offset++] = QR_VERSION;
  // session_id [16]
  payload.set(sessionId, offset); offset += 16;
  // sender_pub [65]
  payload.set(senderPubKey, offset); offset += 65;
  // timestamp [8]
  view.setBigUint64(offset, timestampMs, false); offset += 8;
  // ttl [4]
  view.setUint32(offset, QR_TTL_MS, false); offset += 4;
  // sig_server [50] — ASCII, null-padded
  const urlBytes = new TextEncoder().encode(signalingUrl.slice(0, 50));
  payload.set(urlBytes, offset); offset += 50;

  // Derive HMAC secret and sign all preceding bytes
  const secret = await deriveQRSecret(senderPubKey, timestampMs);
  const dataToSign = payload.slice(0, offset); // 146 bytes
  const hmac = await signPayload(secret, dataToSign);

  // hmac [32]
  payload.set(hmac, offset);

  return payload;
}

/** Generate a QR code data URL from the binary payload. */
export async function generateQRDataURL(payload: Uint8Array): Promise<string> {
  // Convert binary to base64url
  const base64Str = btoa(String.fromCharCode(...payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
    
  // The phone's built-in camera will scan this URL and open Chrome!
  const targetUrl = `${window.location.origin}/#r=${base64Str}`;
  
  return QRCode.toDataURL(targetUrl, {
    errorCorrectionLevel: 'L',
    type: 'image/png',
    margin: 2,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/** Generate a new session ID (128-bit CSPRNG). */
export function generateSessionId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}
