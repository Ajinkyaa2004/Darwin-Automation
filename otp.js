// Reads the Darwinbox login OTP that Outlook forwards to Gmail.
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (a Google app password, not your real password)
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

// Darwinbox reuses an OTP for a while instead of sending a new one, so if no
// new email arrives, fall back to the newest one from the last 15 minutes.
async function waitForOtp(sinceMs, { timeoutMs = 120000, onWaiting, fallbackMs = 15 * 60000 } = {}) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Darwinbox asked for an OTP, but GMAIL_USER / GMAIL_APP_PASSWORD are not set");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const deadline = Date.now() + timeoutMs;
  let nudged = false, fallback = null;
  try {
    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = await client.search({ subject: "Unrecognized Login", since: new Date(sinceMs - 86400000) }, { uid: true });
        // newest first
        for (const uid of (uids || []).sort((a, b) => b - a).slice(0, 5)) {
          const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
          if (!msg) continue;
          const at = new Date(msg.internalDate).getTime();
          if (at < sinceMs - fallbackMs) continue;
          const mail = await simpleParser(msg.source);
          const text = (mail.text || "") + " " + String(mail.html || "").replace(/<[^>]+>/g, " ");
          const m = text.replace(/&nbsp;/g, " ").match(/OTP\s*:?\s*(\d{4,8})/i);
          if (!m) continue;
          if (at >= sinceMs - 20000) return { code: m[1], fresh: true };
          if (!fallback) fallback = { code: m[1], fresh: false, at: new Date(at).toISOString() };
        }
      } finally { lock.release(); }
      if (!nudged && onWaiting && Date.now() - sinceMs > 40000) { nudged = true; await onWaiting().catch(() => {}); }
      await new Promise((r) => setTimeout(r, 5000));
    }
  } finally { await client.logout().catch(() => {}); }
  if (fallback) return fallback;
  throw new Error("Darwinbox asked for an OTP, but no forwarded OTP email (new or from the last 15 min) is in Gmail");
}
module.exports = { waitForOtp };
