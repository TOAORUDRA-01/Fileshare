/**
 * QR Payload decoder and verifier.
 * Uses BarcodeDetector API (Chrome/Edge) with @zxing/browser fallback.
 */

import { BrowserQRCodeReader } from '@zxing/browser';
import { verifyPayload, deriveQRSecret } from '../crypto/hmac';
import { QR_MAGIC, QR_VERSION, PAYLOAD_SIZE } from './encode';

export interface ParsedQRPayload {
  sessionId: Uint8Array;       // 16 bytes
  senderPubKey: Uint8Array;    // 65 bytes
  signalingUrl: string;
  timestampMs: bigint;
  ttlMs: number;
}

/** Parse and cryptographically verify a raw QR payload. Throws on any failure. */
export async function parseAndVerifyPayload(bytes: Uint8Array): Promise<ParsedQRPayload> {
  if (bytes.length < PAYLOAD_SIZE) {
    throw new Error(`Payload too short: ${bytes.length} < ${PAYLOAD_SIZE}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let offset = 0;

  // Verify magic
  if (bytes[0] !== QR_MAGIC[0] || bytes[1] !== QR_MAGIC[1]) {
    throw new Error('Invalid QR magic bytes — not a QR-Beam payload');
  }
  offset += 2;

  // Verify version
  if (bytes[offset] !== QR_VERSION) {
    throw new Error(`Unknown QR-Beam version: 0x${bytes[offset].toString(16)}`);
  }
  offset += 1;

  // session_id [16]
  const sessionId = bytes.slice(offset, offset + 16); offset += 16;
  // sender_pub [65]
  const senderPubKey = bytes.slice(offset, offset + 65); offset += 65;
  // timestamp [8]
  const timestampMs = view.getBigUint64(offset, false); offset += 8;
  // ttl [4]
  const ttlMs = view.getUint32(offset, false); offset += 4;
  // sig_server [50]
  const urlRaw = bytes.slice(offset, offset + 50); offset += 50;
  const nullIdx = urlRaw.indexOf(0);
  const signalingUrl = new TextDecoder().decode(nullIdx === -1 ? urlRaw : urlRaw.slice(0, nullIdx));
  // hmac [32]
  const hmac = bytes.slice(offset, offset + 32);

  // --- Timestamp freshness check ---
  const nowMs = BigInt(Date.now());
  const age = nowMs - timestampMs;
  if (age < 0n || age > BigInt(ttlMs)) {
    throw new Error(`QR payload expired (age: ${age}ms, ttl: ${ttlMs}ms). Please rescan.`);
  }

  // --- HMAC verification ---
  const secret = await deriveQRSecret(senderPubKey, timestampMs);
  const dataToVerify = bytes.slice(0, PAYLOAD_SIZE - 32); // everything before hmac
  const valid = await verifyPayload(secret, dataToVerify, hmac);
  if (!valid) {
    throw new Error('QR payload HMAC verification failed — possible tampering or wrong sender');
  }

  return { sessionId, senderPubKey, signalingUrl, timestampMs, ttlMs };
}

/** Detect if BarcodeDetector is available and supports QR codes. */
async function hasBarcodeDetector(): Promise<boolean> {
  if (!('BarcodeDetector' in window)) return false;
  try {
    // @ts-ignore
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

/** Scan a single video frame using BarcodeDetector API. */
async function scanFrameBarcodeDetector(video: HTMLVideoElement): Promise<string | null> {
  // @ts-ignore
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const barcodes = await detector.detect(video);
  return barcodes.length > 0 ? barcodes[0].rawValue : null;
}

let zxingReader: BrowserQRCodeReader | null = null;

function getZxingReader(): BrowserQRCodeReader {
  if (!zxingReader) zxingReader = new BrowserQRCodeReader();
  return zxingReader;
}

export interface ScanCallbacks {
  onFrame: (video: HTMLVideoElement) => Promise<void>;
  onResult: (payload: ParsedQRPayload) => void;
  onError: (err: Error) => void;
}

/**
 * Start continuous QR scanning from camera.
 * Returns a stop() function to release the camera.
 */
export async function startQRScanner(
  videoEl: HTMLVideoElement,
  onResult: (payload: ParsedQRPayload) => void,
  onError: (err: Error) => void
): Promise<() => void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch {
    onError(new Error('Camera access denied. Please allow camera permissions.'));
    return () => {};
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  const useNative = await hasBarcodeDetector();
  let stopped = false;
  let lastScanned = '';

  const scanLoop = async () => {
    if (stopped) return;

    try {
      let rawValue: string | null = null;

      if (useNative) {
        rawValue = await scanFrameBarcodeDetector(videoEl);
      } else {
        // zxing-js: decode from canvas snapshot
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(videoEl, 0, 0);
        try {
          const result = getZxingReader().decodeFromCanvas(canvas);
          rawValue = result?.getText() ?? null;
        } catch {
          rawValue = null;
        }
      }

      if (rawValue && rawValue !== lastScanned) {
        lastScanned = rawValue;
        // Convert latin1 string back to bytes
        const bytes = new Uint8Array(rawValue.split('').map((c) => c.charCodeAt(0)));
        try {
          const payload = await parseAndVerifyPayload(bytes);
          onResult(payload);
          stopped = true; // stop scanning after successful parse
          return;
        } catch (e) {
          // Not a valid QR-Beam payload or expired — keep scanning
        }
      }
    } catch (e) {
      // Frame decode error — keep scanning
    }

    if (!stopped) {
      requestAnimationFrame(scanLoop);
    }
  };

  requestAnimationFrame(scanLoop);

  return () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
  };
}
