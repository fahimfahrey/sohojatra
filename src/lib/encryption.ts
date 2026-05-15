/**
 * Simple encryption utility for real-time data
 * Uses base64 encoding with a simple XOR cipher for client-side encryption
 * For production, consider using TweetNaCl.js or libsodium.js
 */

// Simple encryption key (in production, this should be derived from user session)
const ENCRYPTION_KEY = "sohojatra-realtime-encryption-v1";

/**
 * Simple XOR cipher for basic encryption
 * Note: This is NOT cryptographically secure. For production use,
 * implement proper encryption using TweetNaCl.js or similar.
 */
function xorEncrypt(data: string, key: string): string {
  let result = "";
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(
      data.charCodeAt(i) ^ key.charCodeAt(i % key.length),
    );
  }
  return result;
}

function xorDecrypt(encrypted: string, key: string): string {
  return xorEncrypt(encrypted, key); // XOR is symmetric
}

/**
 * Encrypt data for real-time transmission
 * @param data Object to encrypt
 * @returns Encrypted string (base64 encoded)
 */
export const encryptRealTimeData = (data: Record<string, unknown>): string => {
  try {
    const jsonString = JSON.stringify(data);
    const encrypted = xorEncrypt(jsonString, ENCRYPTION_KEY);
    return btoa(encrypted); // Base64 encode
  } catch (error) {
    throw new Error("Failed to encrypt real-time data");
  }
};

/**
 * Decrypt data from real-time transmission
 * @param encryptedData Base64 encoded encrypted string
 * @returns Decrypted object
 */
export const decryptRealTimeData = (
  encryptedData: string,
): Record<string, unknown> => {
  try {
    const encrypted = atob(encryptedData); // Base64 decode
    const decrypted = xorDecrypt(encrypted, ENCRYPTION_KEY);
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error("Failed to decrypt real-time data");
  }
};

/**
 * Encrypt sensitive fields in ride data
 * @param rideData Ride data object
 * @returns Ride data with encrypted sensitive fields
 */
export const encryptRideSensitiveData = (
  rideData: Record<string, unknown>,
): Record<string, unknown> => {
  const encrypted = { ...rideData };

  // Encrypt location data
  if (encrypted.startingPoint) {
    encrypted.startingPoint = {
      ...encrypted.startingPoint,
      address: xorEncrypt(
        (encrypted.startingPoint as Record<string, unknown>).address as string,
        ENCRYPTION_KEY,
      ),
    };
  }

  if (encrypted.destination) {
    encrypted.destination = {
      ...encrypted.destination,
      address: xorEncrypt(
        (encrypted.destination as Record<string, unknown>).address as string,
        ENCRYPTION_KEY,
      ),
    };
  }

  return encrypted;
};

/**
 * Decrypt sensitive fields in ride data
 * @param rideData Encrypted ride data object
 * @returns Ride data with decrypted sensitive fields
 */
export const decryptRideSensitiveData = (
  rideData: Record<string, unknown>,
): Record<string, unknown> => {
  const decrypted = { ...rideData };

  // Decrypt location data
  if (decrypted.startingPoint) {
    decrypted.startingPoint = {
      ...decrypted.startingPoint,
      address: xorDecrypt(
        (decrypted.startingPoint as Record<string, unknown>).address as string,
        ENCRYPTION_KEY,
      ),
    };
  }

  if (decrypted.destination) {
    decrypted.destination = {
      ...decrypted.destination,
      address: xorDecrypt(
        (decrypted.destination as Record<string, unknown>).address as string,
        ENCRYPTION_KEY,
      ),
    };
  }

  return decrypted;
};
