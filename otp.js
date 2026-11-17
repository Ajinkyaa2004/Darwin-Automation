// Reads Darwinbox login OTPs that Outlook forwards to Gmail.
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (a Google app password, not your real password)
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

// Newest OTP email received after `afterMs`. Polls Gmail for up to `waitMs`. Returns null if none.
async function latestOtp(afterMs, waitMs = 0) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Darwinbox asked for an OTP, but GMAIL_USER / GMAIL_APP_PASSWORD are not set");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = await client.search({ subject: "Unrecognized Login", since: new Date(afterMs - 86400000) }, { uid: true });
        for (const uid of (uids || []).sort((a, b) => b - a).slice(0, 5)) {
          const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
          if (!msg) continue;
          const at = new Date(msg.internalDate).getTime();
          if (at < afterMs) continue;
          const mail = await simpleParser(msg.source);
          const text = ((mail.text || "") + " " + String(mail.html || "").replace(/<[^>]+>/g, " ")).replace(/&nbsp;/g, " ");
          const m = text.match(/OTP\s*:?\s*(\d{4,8})/i);
          if (m) return { code: m[1], at: new Date(at).toISOString() };
        }
      } finally { lock.release(); }
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, 5000));
    }
  } finally { await client.logout().catch(() => {}); }
}
module.exports = { latestOtp };
