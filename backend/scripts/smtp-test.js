import { sendMailMessage } from '../src/lib/mail.js';
import { env } from '../src/lib/env.js';

const target = String(process.argv[2] || '').trim() || env.smtp.from;

if (!target) {
  console.error('Usage: node scripts/smtp-test.js <recipient-email>');
  process.exit(1);
}

try {
  const info = await sendMailMessage({
    to: target,
    subject: `SMTP test ${new Date().toISOString()}`,
    text: `SMTP test to ${target}`,
    html: `<p>SMTP test to <strong>${target}</strong></p>`
  });
  console.log(JSON.stringify({
    ok: true,
    target,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    target,
    code: error.code || '',
    message: error.message || String(error)
  }, null, 2));
  process.exit(1);
}
