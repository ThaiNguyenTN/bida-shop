import crypto from 'crypto';
import { sendEmailOtp } from '../../lib/mail.js';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashOtpCode(otp) {
  return crypto.createHash('sha256').update(String(otp || '')).digest('hex');
}

export function buildOtpState() {
  const otp = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const sentAt = new Date();
  return {
    otp,
    otpHash: hashOtpCode(otp),
    expiresAt,
    sentAt
  };
}

export function getOtpCooldownSeconds(lastSentAt) {
  if (!lastSentAt) return 0;
  const remainingMs = OTP_RESEND_COOLDOWN_MS - (Date.now() - new Date(lastSentAt).getTime());
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function isOtpExpired(expiresAt) {
  return !expiresAt || new Date(expiresAt).getTime() < Date.now();
}

export async function sendVerificationOtpEmail(email, otp) {
  return sendEmailOtp(email, otp);
}
