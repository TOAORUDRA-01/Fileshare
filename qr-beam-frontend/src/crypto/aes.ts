/**
 * AES-256-GCM encryption/decryption.
 * Each chunk uses a unique 96-bit IV — never reused.
 */

const IV_LENGTH = 12; // 96 bits
const TAG_LENGTH = 128; // bits

/** Generate a cryptographically random 96-bit IV. */
export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/** Encrypt plaintext with AES-256-GCM. Returns IV + ciphertext. */
export async function encryptChunk(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = generateIV();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
        tagLength: TAG_LENGTH,
        ...(additionalData ? { additionalData: additionalData.buffer as ArrayBuffer } : {}),
      },
      key,
      plaintext.buffer as ArrayBuffer
    )
  );
  return { iv, ciphertext };
}

/** Decrypt AES-256-GCM ciphertext (includes 16-byte auth tag). */
export async function decryptChunk(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
      tagLength: TAG_LENGTH,
      ...(additionalData ? { additionalData: additionalData.buffer as ArrayBuffer } : {}),
    },
    key,
    ciphertext.buffer as ArrayBuffer
  );
  return new Uint8Array(plaintext);
}

/** Compute SHA-256 hash of data. Returns hex string. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compute SHA-256 of a File. */
export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
