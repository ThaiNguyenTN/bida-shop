import nodemailer from 'nodemailer';
import { env } from './env.js';

let transporter = null;
if (env.smtp && env.smtp.host) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port || 587,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined
  });
}

export async function sendMailMessage({ to, subject, html, text = '' }) {
  if (!transporter) {
    const error = new Error('SMTP not configured');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  try {
    const info = await transporter.sendMail({
      from: env.smtp.from || `no-reply@${new URL(env.frontendUrl).hostname}`,
      to,
      subject,
      text,
      html
    });
    console.log('Sent mail', info.messageId, 'accepted:', info.accepted, 'rejected:', info.rejected);
    if (!Array.isArray(info.accepted) || !info.accepted.length || (Array.isArray(info.rejected) && info.rejected.length)) {
      const error = new Error(`SMTP delivery not accepted. accepted=${JSON.stringify(info.accepted || [])} rejected=${JSON.stringify(info.rejected || [])}`);
      error.code = 'SMTP_RECIPIENT_REJECTED';
      throw error;
    }
    return info;
  } catch (error) {
    const message = error && error.message ? error.message : String(error || 'SMTP send failed');
    console.error('SMTP send failed for', to, 'host', env.smtp.host, 'error:', message);
    const sendError = new Error(message);
    if (error?.code === 'SMTP_RECIPIENT_REJECTED') sendError.code = 'SMTP_RECIPIENT_REJECTED';
    else sendError.code = /unauthorized ip address/i.test(message) ? 'SMTP_UNAUTHORIZED_IP' : 'SMTP_SEND_FAILED';
    throw sendError;
  }
}

export async function sendEmailOtp(to, otp) {
  const html = `<p>Xin chao,</p><p>Ma OTP xac thuc email cua ban la:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${otp}</p><p>Ma co hieu luc trong 5 phut. Neu ban khong yeu cau, hay bo qua email nay.</p>`;
  const text = `Ma OTP xac thuc email cua ban la ${otp}. Ma co hieu luc trong 5 phut.`;
  return sendMailMessage({
    to,
    subject: 'Ma OTP xac thuc email - Bida Shop',
    html,
    text
  });
}
