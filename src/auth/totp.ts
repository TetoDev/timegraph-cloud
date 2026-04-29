// src/auth/totp.ts
import { TOTP } from "otpauth";
import QRCode from "qrcode";
import { randomBytes } from "crypto";

const ISSUER = "PLPP";

export function generateTOTPSecret(): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  return totp.secret.base32;
}

export function generateTOTPURI(secret: string, username: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return totp.toString();
}

export async function generateQRCodeDataURL(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2 });
}

export function verifyTOTP(secret: string, token: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    label: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  // Allow ±1 step tolerance for clock drift
  return totp.validate({ token, window: 1 }) !== null;
}

export function generateRecoveryCodes(count: number = 10): string[] {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  const buf = randomBytes(count * 8);
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += chars[buf[i * 8 + j] % chars.length];
    }
    codes.push(code);
  }
  return codes;
}
