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

export async function sendVerificationEmail(to, link) {
  if (!transporter) {
    console.log('SMTP not configured, verification link for', to, link);
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: env.smtp.from || `no-reply@${new URL(env.frontendUrl).hostname}`,
      to,
      subject: 'Xác thực email - Bida Shop',
      html: `<p>Xin chào,</p><p>Vui lòng xác thực email của bạn bằng cách nhấn vào liên kết bên dưới:</p><p><a href="${link}">${link}</a></p><p>Nếu không yêu cầu, bạn có thể bỏ qua email này.</p>`
    });
    console.log('Sent verification email', info.messageId);
    return true;
  } catch (error) {
    console.error('SMTP send failed for', to, 'host', env.smtp.host, 'error:', error && error.message ? error.message : error);
    return false;
  }
}
