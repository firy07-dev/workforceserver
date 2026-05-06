require('dotenv').config();
const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  INVITE_EMAILS,
  APP_LINK,
  INVITE_PASSWORD,
} = process.env;

if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
  console.error('Missing SMTP config. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  process.exit(1);
}

if (!INVITE_EMAILS || !APP_LINK) {
  console.error('Missing INVITE_EMAILS or APP_LINK in env.');
  process.exit(1);
}

const recipients = INVITE_EMAILS.replace(/\n/g, ',')
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);

if (!recipients.length) {
  console.error('INVITE_EMAILS is empty.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

const from = SMTP_FROM || SMTP_USER;

const buildMessage = (employeeId) => {
  const lines = [
    'Hi,',
    '',
    'Please install Workforce LMS using this Play Store link:',
    APP_LINK,
    '',
  ];

  if (employeeId || INVITE_PASSWORD) {
    lines.push('Login details:');
    if (employeeId) lines.push(`Employee ID: ${employeeId}`);
    if (INVITE_PASSWORD) lines.push(`Password: ${INVITE_PASSWORD}`);
    lines.push('');
  }

  lines.push('After installing, open the app once.');
  lines.push('Thanks!');
  return lines.join('\n');
};

async function sendInvites() {
  let sent = 0;

  for (const to of recipients) {
    const employeeId = to.split('@')[0];
    const message = buildMessage(employeeId);
    await transporter.sendMail({
      from,
      to,
      subject: 'Workforce LMS test invite',
      text: message,
    });
    sent += 1;
    console.log(`Sent to ${to}`);
  }

  console.log(`Done. Sent ${sent} email(s).`);
}

sendInvites().catch((err) => {
  console.error('Failed to send invites:', err);
  process.exit(1);
});
