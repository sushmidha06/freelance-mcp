// Generate a polite reply with Gemini, then save it as a Gmail draft via
// IMAP APPEND. Reuses the user's existing Gmail app password — no new auth.

import axios from 'axios';
import { ImapFlow } from 'imapflow';
import { fetchOneGmail } from './gmailFetcher.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MODEL = 'gemini-2.5-flash';

const SYSTEM = `You are a freelance professional replying to client and vendor emails.
Write a concise, polite reply. Match the tone of the original (formal vs casual).
Do NOT invent specifics (prices, dates, deliverables) that aren't in the original.
If you'd need extra info, ask for it briefly.

Respond with JSON only:
{
  "subject": "Re: ..." (keep original subject, prefix with 'Re:' if not already),
  "body": "<plain text reply, no signature line — keep it under 180 words>"
}`;

async function geminiDraft(emailMeta) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      subject: `Re: ${emailMeta.subject}`,
      body: `Hi,\n\nThanks for your email. I'll review and get back to you shortly.\n\nBest regards,`,
    };
  }
  const userMsg = `From: ${emailMeta.from} <${emailMeta.fromAddress}>
Subject: ${emailMeta.subject}
Date: ${emailMeta.date || ''}

Body:
${(emailMeta.body || '').slice(0, 4500)}`;

  const r = await axios.post(`${GEMINI_BASE}/chat/completions`, {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.4,
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const text = r.data?.choices?.[0]?.message?.content?.trim() || '{}';
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return {
      subject: parsed.subject || `Re: ${emailMeta.subject}`,
      body:    parsed.body    || 'Thanks for your email — replying shortly.',
    };
  } catch {
    return { subject: `Re: ${emailMeta.subject}`, body: clean };
  }
}

function buildRfc822({ fromAddr, fromName, toAddr, toName, subject, body, inReplyTo, references }) {
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}-${Math.random().toString(36).slice(2, 10)}@sushmi-mcp.local>`;
  const fromHeader = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
  const toHeader   = toName   ? `${toName} <${toAddr}>`     : toAddr;

  const headers = [
    `Date: ${date}`,
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (inReplyTo)  headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  return headers.join('\r\n') + '\r\n\r\n' + body.replace(/\r?\n/g, '\r\n');
}

// Best-effort discovery of the right Drafts mailbox name (Gmail localises).
async function findDraftsMailbox(client) {
  // Most accounts: '[Gmail]/Drafts'. Some localised: '[Google Mail]/Drafts',
  // 'INBOX.Drafts', or just 'Drafts'. We list and pick the one with \Drafts attribute.
  const list = await client.list();
  for (const box of list) {
    const flags = box.flags || new Set();
    if ((flags.has && flags.has('\\Drafts')) || flags === '\\Drafts' ||
        (Array.isArray(flags) && flags.includes('\\Drafts'))) {
      return box.path;
    }
  }
  // Fall back to common defaults
  for (const candidate of ['[Gmail]/Drafts', '[Google Mail]/Drafts', 'INBOX.Drafts', 'Drafts']) {
    if (list.find(b => b.path === candidate)) return candidate;
  }
  return '[Gmail]/Drafts';
}

export async function draftReplyForEmail({ user, emailUid }) {
  // 1. Fetch the original
  const meta = await fetchOneGmail({ email: user.email, appPassword: user.appPassword, uid: emailUid });

  // 2. Ask Gemini
  const { subject, body } = await geminiDraft(meta);

  // 3. Build RFC822 reply tied to the original thread (if we can pull a Message-ID)
  const inReplyTo = meta.messageId || null;
  const references = inReplyTo;

  const rfc822 = buildRfc822({
    fromAddr: user.email,
    fromName: user.email.split('@')[0],
    toAddr:   meta.fromAddress || meta.from,
    toName:   meta.from,
    subject,
    body,
    inReplyTo,
    references,
  });

  // 4. APPEND to Drafts
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: user.email, pass: user.appPassword },
    logger: false,
  });
  await client.connect();
  let drafts = '[Gmail]/Drafts';
  try {
    drafts = await findDraftsMailbox(client);
    await client.append(drafts, rfc822, ['\\Draft', '\\Seen']);
  } finally {
    await client.logout().catch(() => {});
  }

  return {
    ok: true,
    draftsMailbox: drafts,
    subject,
    bodyPreview: body.slice(0, 240),
    to: meta.fromAddress || meta.from,
  };
}
