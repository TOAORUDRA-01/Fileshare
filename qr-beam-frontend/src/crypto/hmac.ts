/**
 * HMAC-SHA256 signing and verification for QR payload authentication.
 * Constant-time comparison via Web Crypto prevents timing attacks.
 */

async function importHMACKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secret.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Sign data with HMAC-SHA256. Returns 32-byte MAC. */
export async function signPayload(secret: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await importHMACKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

/** Verify HMAC-SHA256 in constant time. Returns true if valid. */
export async function verifyPayload(
  secret: Uint8Array,
  data: Uint8Array,
  mac: Uint8Array
): Promise<boolean> {
  const key = await importHMACKey(secret);
  return crypto.subtle.verify('HMAC', key, mac.buffer as ArrayBuffer, data.buffer as ArrayBuffer);
}

/**
 * Derive the HMAC secret from ECDH public key + timestamp.
 */
export async function deriveQRSecret(
  ecdhPublicKeyBytes: Uint8Array,
  timestampMs: bigint
): Promise<Uint8Array> {
  const tsBuf = new Uint8Array(8);
  const tsView = new DataView(tsBuf.buffer);
  tsView.setBigUint64(0, timestampMs, false);

  const combined = new Uint8Array(ecdhPublicKeyBytes.length + 8);
  combined.set(ecdhPublicKeyBytes, 0);
  combined.set(tsBuf, ecdhPublicKeyBytes.length);

  const hash = await crypto.subtle.digest('SHA-256', combined.buffer as ArrayBuffer);
  return new Uint8Array(hash);
}
