/**
 * Real-time data encryption using TweetNaCl (nacl.secretbox).
 *
 * - Symmetric authenticated encryption (XSalsa20 + Poly1305 MAC).
 * - Key derived from a shared secret via PBKDF2-HMAC-SHA-256 (Web Crypto).
 * - Each ciphertext uses a fresh random 24-byte nonce, prepended to the box.
 *
 * Note: a shared client-side secret cannot defend against a malicious client
 * extracting the key. This module exists to (a) prevent passive observers
 * on the wire from reading payloads and (b) detect tampering. Per-user keys
 * negotiated over an authenticated channel should replace this for stronger
 * threat models.
 */

import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const SECRET =
  process.env.NEXT_PUBLIC_REALTIME_ENCRYPTION_SECRET ??
  "sohojatra-realtime-encryption-v1";

// Fixed application salt: deterministic key derivation so independent
// clients/servers derive the same symmetric key from the shared secret.
const SALT = naclUtil.decodeUTF8("sohojatra-pbkdf2-salt-v1");
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;

let cachedKey: Promise<Uint8Array> | null = null;

async function deriveKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;

  cachedKey = (async () => {
    const subtle =
      typeof globalThis !== "undefined" && globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error(
        "Web Crypto SubtleCrypto unavailable; cannot derive encryption key",
      );
    }

    const baseKey = await subtle.importKey(
      "raw",
      naclUtil.decodeUTF8(SECRET) as BufferSource,
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );

    const bits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: SALT as BufferSource,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      baseKey,
      KEY_LENGTH_BITS,
    );

    return new Uint8Array(bits);
  })();

  return cachedKey;
}

async function encryptString(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = naclUtil.decodeUTF8(plaintext);
  const box = nacl.secretbox(message, nonce, key);

  const packed = new Uint8Array(nonce.length + box.length);
  packed.set(nonce, 0);
  packed.set(box, nonce.length);
  return naclUtil.encodeBase64(packed);
}

async function decryptString(encoded: string): Promise<string> {
  const key = await deriveKey();
  const packed = naclUtil.decodeBase64(encoded);

  if (packed.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
    throw new Error("Ciphertext too short");
  }

  const nonce = packed.slice(0, nacl.secretbox.nonceLength);
  const box = packed.slice(nacl.secretbox.nonceLength);
  const plain = nacl.secretbox.open(box, nonce, key);

  if (!plain) {
    throw new Error("Authentication failed");
  }
  return naclUtil.encodeUTF8(plain);
}

/**
 * Encrypt data for real-time transmission.
 * @param data Object to encrypt
 * @returns Base64-encoded `nonce || ciphertext+MAC`
 */
export const encryptRealTimeData = async (
  data: Record<string, unknown>,
): Promise<string> => {
  try {
    return await encryptString(JSON.stringify(data));
  } catch {
    throw new Error("Failed to encrypt real-time data");
  }
};

/**
 * Decrypt data from real-time transmission.
 * @param encryptedData Base64-encoded `nonce || ciphertext+MAC`
 * @returns Decrypted object
 */
export const decryptRealTimeData = async (
  encryptedData: string,
): Promise<Record<string, unknown>> => {
  try {
    const json = await decryptString(encryptedData);
    return JSON.parse(json);
  } catch {
    throw new Error("Failed to decrypt real-time data");
  }
};

/**
 * Encrypt sensitive fields (addresses) in ride data.
 */
export const encryptRideSensitiveData = async (
  rideData: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const encrypted = { ...rideData };

  if (encrypted.startingPoint) {
    const sp = encrypted.startingPoint as Record<string, unknown>;
    encrypted.startingPoint = {
      ...sp,
      address: await encryptString(sp.address as string),
    };
  }

  if (encrypted.destination) {
    const d = encrypted.destination as Record<string, unknown>;
    encrypted.destination = {
      ...d,
      address: await encryptString(d.address as string),
    };
  }

  return encrypted;
};

/**
 * Decrypt sensitive fields (addresses) in ride data.
 */
export const decryptRideSensitiveData = async (
  rideData: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const decrypted = { ...rideData };

  if (decrypted.startingPoint) {
    const sp = decrypted.startingPoint as Record<string, unknown>;
    decrypted.startingPoint = {
      ...sp,
      address: await decryptString(sp.address as string),
    };
  }

  if (decrypted.destination) {
    const d = decrypted.destination as Record<string, unknown>;
    decrypted.destination = {
      ...d,
      address: await decryptString(d.address as string),
    };
  }

  return decrypted;
};
