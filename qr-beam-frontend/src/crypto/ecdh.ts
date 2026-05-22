/**
 * ECDH P-256 key generation and shared key derivation.
 * Private keys are marked non-extractable and never leave the browser tab.
 */

export interface ECDHKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array; // 65-byte uncompressed
}

/** Generate an ephemeral ECDH P-256 key pair. Private key is non-extractable. */
export async function generateECDHKeyPair(): Promise<ECDHKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  );
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey)
  );
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyBytes,
  };
}

/** Import a raw 65-byte P-256 public key from the peer. */
export async function importPeerPublicKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawBytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Derive a 256-bit AES-GCM key from ECDH shared secret via HKDF-SHA256.
 */
export async function deriveSharedAESKey(
  myPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  sessionId: Uint8Array
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    myPrivateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  const info = new TextEncoder().encode('qrbeam-v1');
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: sessionId.buffer as ArrayBuffer,
      info: info.buffer as ArrayBuffer,
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
