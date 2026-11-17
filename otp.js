// Reads the Darwinbox login OTP that Outlook forwards to Gmail.
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (a Google app password, not your real password)
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

async function waitForOtp(sinceMs, timeoutMs = 120000) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Darwinbox asked for an OTP, but GMAIL_USER / GMAIL_APP_PASSWORD are not set");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = await client.search({ subject: "Unrecognized Login", since: new Date(sinceMs - 86400000) }, { uid: true });
        // newest first
        for (const uid of (uids || []).sort((a, b) => b - a).slice(0, 5)) {
          const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
          if (!msg || new Date(msg.internalDate).getTime() < sinceMs - 20000) continue;
          const mail = await simpleParser(msg.source);
          const text = (mail.text || "") + " " + String(mail.html || "").replace(/<[^>]+>/g, " ");
          const m = text.replace(/&nbsp;/g, " ").match(/OTP\s*:?\s*(\d{4,8})/i);
          if (m) return m[1];
        }
      } finally { lock.release(); }
      await new Promise((r) => setTimeout(r, 5000));
    }
  } finally { await client.logout().catch(() => {}); }
  throw new Error("Darwinbox asked for an OTP, but no forwarded OTP email reached Gmail within 2 minutes");
}
module.exports = { waitForOtp };
