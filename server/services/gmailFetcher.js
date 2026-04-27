import { ImapFlow } from 'imapflow';

// Lightweight Gmail reader — used by GET /api/inbox/gmail to populate the
// Inbox Triage page. Only pulls envelope data (no bodies) to keep Gemini
// token cost low; the agent can fetch full bodies on demand via the MCP tool.

function classify(envelope) {
  const subject = (envelope?.subject || '').toLowerCase();
  const from    = (envelope?.from?.[0]?.address || '').toLowerCase();

  const highKeywords   = ['urgent', 'asap', 'invoice', 'payment', 'overdue', 'critical', 'emergency'];
  const mediumKeywords = ['review', 'pr ', 'pull request', 'meeting', 'deadline', 'follow up', 'follow-up', 'reminder'];

  if (highKeywords.some(k => subject.includes(k))) return 'high';
  if (mediumKeywords.some(k => subject.includes(k))) return 'medium';
  if (from.includes('noreply') || from.includes('no-reply')) return 'low';
  return 'medium';
}

function labelFor(envelope) {
  const from = (envelope?.from?.[0]?.address || '').toLowerCase();
  if (from.includes('github')) return 'Engineering';
  if (from.includes('stripe') || from.includes('razorpay')) return 'Billing';
  if (from.includes('linear') || from.includes('jira')) return 'Tickets';
  if (from.includes('calendly') || from.includes('cal.com') || from.includes('calendar')) return 'Calendar';
  if (from.includes('noreply') || from.includes('no-reply')) return 'Notifications';
  return 'Inbox';
}

function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  return d + 'd';
}

// Fetch one email's full body (text/plain preferred, HTML stripped of tags as fallback)
// keyed by Gmail UID. Returns { subject, from, fromAddress, date, body }.
export async function fetchOneGmail({ email, appPassword, uid }) {
  if (!uid) throw new Error('uid required');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true, source: true }, { uid: true });
    if (!msg) throw new Error(`uid ${uid} not found`);
    const env = msg.envelope || {};
    const fromAddr = env.from?.[0]?.address || '';
    const fromName = env.from?.[0]?.name || fromAddr || 'Unknown';

    let body = '';
    if (msg.source) {
      const raw = msg.source.toString('utf8');
      // Crudely split off headers to get the body. Good enough for plain emails.
      const split = raw.indexOf('\r\n\r\n');
      const rawBody = split >= 0 ? raw.slice(split + 4) : raw;
      // Strip HTML tags if present, normalise whitespace, cap at 6 KB so Gemini calls stay cheap.
      body = rawBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
    }
    return {
      uid: String(uid),
      subject: env.subject || '',
      from: fromName,
      fromAddress: fromAddr,
      date: env.date ? new Date(env.date).toISOString() : null,
      messageId: env.messageId || null,
      body,
    };
  } finally {
    if (lock) lock.release();
    await client.logout().catch(() => {});
  }
}

// Fetch many emails *with bodies* for RAG indexing. Heavier than fetchRecentGmail.
export async function fetchGmailWithBodies({ email, appPassword, days = 30, limit = 100 }) {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const all = [];
    for await (const msg of client.fetch({ since }, { uid: true, envelope: true, internalDate: true, source: true })) {
      all.push(msg);
    }
    const newest = all.sort((a, b) => b.uid - a.uid).slice(0, limit);
    const out = [];
    for (const m of newest) {
      const env = m.envelope || {};
      const fromAddr = env.from?.[0]?.address || '';
      const fromName = env.from?.[0]?.name || fromAddr || 'Unknown';
      let body = '';
      if (m.source) {
        const raw = m.source.toString('utf8');
        const split = raw.indexOf('\r\n\r\n');
        const rawBody = split >= 0 ? raw.slice(split + 4) : raw;
        // Strip HTML, normalise whitespace, cap at 4 KB to keep embeddings cheap.
        body = rawBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
      }
      out.push({
        uid: String(m.uid),
        from: fromName,
        fromAddress: fromAddr,
        subject: env.subject || '(no subject)',
        date: m.internalDate ? new Date(m.internalDate).toISOString() : (env.date ? new Date(env.date).toISOString() : null),
        body,
      });
    }
    return out;
  } finally {
    if (lock) lock.release();
    await client.logout().catch(() => {});
  }
}

export async function fetchRecentGmail({ email, appPassword, days = 7, limit = 15 }) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });

  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const out = [];
    // Iterate newest first by passing reverse uids; ImapFlow's fetch yields oldest-first by default.
    const uids = [];
    for await (const msg of client.fetch({ since }, { uid: true, envelope: true, internalDate: true })) {
      uids.push(msg);
    }
    const newest = uids.sort((a, b) => b.uid - a.uid).slice(0, limit);
    for (const m of newest) {
      const env = m.envelope || {};
      const fromAddr = env.from?.[0]?.address || '';
      const fromName = env.from?.[0]?.name || fromAddr || 'Unknown';
      out.push({
        id: 'g_' + m.uid,
        uid: String(m.uid),
        from: fromName,
        fromAddress: fromAddr,
        subject: env.subject || '(no subject)',
        preview: '',
        time: timeAgo(m.internalDate || env.date),
        receivedAt: (m.internalDate || env.date || new Date()).toISOString?.() || new Date().toISOString(),
        priority: classify(env),
        label: labelFor(env),
      });
    }
    return out;
  } finally {
    if (lock) lock.release();
    await client.logout().catch(() => {});
  }
}
