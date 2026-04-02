const nodemailer = require('nodemailer');

const getMailerConfig = () => ({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
});

const createTransport = () => {
  const cfg = getMailerConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('Email service is not configured');
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
};

const sendMail = async ({ to, subject, text, html }) => {
  const cfg = getMailerConfig();
  const transporter = createTransport();
  return transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
    html,
  });
};

module.exports = { sendMail };
