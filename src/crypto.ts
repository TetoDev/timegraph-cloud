// src/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedMasterKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  const key = Buffer.from(envKey, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters), got ${key.length} bytes`
    );
  }

  cachedMasterKey = key;
  return key;
}

export function encrypt(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(ciphertext: Buffer, iv: Buffer, authTag: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptProjectData(data: object): {
  encryptedData: string;
  encryptedDEK: string;
  dataIV: string;
  deKIV: string;
} {
  const masterKey = getMasterKey();
  const dek = randomBytes(KEY_LENGTH);

  const dataPlaintext = Buffer.from(JSON.stringify(data));
  const { ciphertext: encryptedData, iv: dataIV, authTag: dataAuthTag } = encrypt(dataPlaintext, dek);

  const { ciphertext: encryptedDEK, iv: deKIV, authTag: dekAuthTag } = encrypt(dek, masterKey);

  // Concatenate ciphertext + authTag for storage
  const dataWithAuth = Buffer.concat([encryptedData, dataAuthTag]);
  const dekWithAuth = Buffer.concat([encryptedDEK, dekAuthTag]);

  return {
    encryptedData: dataWithAuth.toString("base64"),
    encryptedDEK: dekWithAuth.toString("base64"),
    dataIV: dataIV.toString("base64"),
    deKIV: deKIV.toString("base64"),
  };
}

export function decryptProjectData(
  encryptedData: string,
  encryptedDEK: string,
  dataIV: string,
  deKIV: string
): object {
  const masterKey = getMasterKey();

  const dataWithAuth = Buffer.from(encryptedData, "base64");
  const dekWithAuth = Buffer.from(encryptedDEK, "base64");
  const dataIVBuf = Buffer.from(dataIV, "base64");
  const deKIVBuf = Buffer.from(deKIV, "base64");

  // Split ciphertext and auth tag
  const dataCiphertext = dataWithAuth.slice(0, -AUTH_TAG_LENGTH);
  const dataAuthTag = dataWithAuth.slice(-AUTH_TAG_LENGTH);
  const dekCiphertext = dekWithAuth.slice(0, -AUTH_TAG_LENGTH);
  const dekAuthTag = dekWithAuth.slice(-AUTH_TAG_LENGTH);

  // Decrypt DEK
  const dek = decrypt(dekCiphertext, deKIVBuf, dekAuthTag, masterKey);

  // Decrypt data
  const plaintext = decrypt(dataCiphertext, dataIVBuf, dataAuthTag, dek);

  return JSON.parse(plaintext.toString());
}

export function encryptPartDescription(text: string): string {
  if (!text) return "";
  const masterKey = getMasterKey();
  const plaintext = Buffer.from(text, "utf8");
  const { ciphertext, iv, authTag } = encrypt(plaintext, masterKey);
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptPartDescription(encrypted: string): string {
  if (!encrypted) return "";
  const masterKey = getMasterKey();
  const buf = Buffer.from(encrypted, "base64");

  const iv = buf.slice(0, IV_LENGTH);
  const authTag = buf.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.slice(IV_LENGTH + AUTH_TAG_LENGTH);

  const plaintext = decrypt(ciphertext, iv, authTag, masterKey);
  return plaintext.toString("utf8");
}
