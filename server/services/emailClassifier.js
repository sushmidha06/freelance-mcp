// Pure function — takes an email envelope + the user's project clients,
// returns a folder path. No I/O.
//
// Folder shape:
//   - "clients/{clientName}"  — emails matching one of the user's project clients
//   - "expenses"              — billing / payment / receipt / invoice senders
//   - "github"                — github.com senders / GitHub keywords
//   - "calendar"              — google calendar / calendly / cal.com / scheduling
//   - "other"                 — everything else

const FINANCE_DOMAINS   = /(stripe|razorpay|paypal|wise|payoneer|quickbooks|freshbooks|xero|gusto|deel)\./i;
const FINANCE_KEYWORDS  = /(invoice|payment|receipt|payout|refund|bill|charge|subscription)/i;

const GITHUB_DOMAINS    = /github\.com|githubusercontent\.com/i;
const GITHUB_KEYWORDS   = /\b(pr |pull request|commit|merge|issue|workflow)\b/i;

const CALENDAR_DOMAINS  = /(calendar-noreply@google\.com|calendly\.com|cal\.com|fantastical|woven|reclaim\.ai)/i;
const CALENDAR_KEYWORDS = /\b(meeting|invite|invitation|scheduled|booking|reschedul|standup|sync)\b/i;

const SYSTEM_DOMAINS    = /(noreply|no-reply|notifications?|alerts?)@/i;


function extractDomain(emailAddr) {
  if (!emailAddr) return '';
  const at = emailAddr.indexOf('@');
  if (at < 0) return '';
  return emailAddr.slice(at + 1).toLowerCase().trim();
}

function domainCore(domain) {
  if (!domain) return '';
  // strip subdomains down to the registrable part (very rough — fine for folder labels)
  const parts = domain.split('.');
  if (parts.length <= 2) return parts[0] || '';
  // For ".co.uk", ".com.au" style, take the third-to-last
  const tld2 = parts.slice(-2).join('.');
  if (/^(co\.uk|com\.au|co\.in|co\.jp|com\.br)$/.test(tld2)) {
    return parts[parts.length - 3] || parts[0] || '';
  }
  return parts[parts.length - 2] || parts[0] || '';
}

function clientMatch(fromAddr, fromName, projectClients) {
  if (!projectClients || projectClients.length === 0) return null;
  const domain = extractDomain(fromAddr);
  const core = domainCore(domain);
  const nameLower = (fromName || '').toLowerCase();
  for (const client of projectClients) {
    if (!client) continue;
    const c = client.toLowerCase().trim();
    if (!c) continue;
    // Match if: client name appears in domain core, in display name, or vice-versa.
    // Also try first word of multi-word client names (e.g. "Northwind Labs" → "northwind").
    const firstWord = c.split(/\s+/)[0];
    if (
      core.includes(firstWord) ||
      firstWord.includes(core) ||
      nameLower.includes(c) ||
      nameLower.includes(firstWord)
    ) {
      return client;
    }
  }
  return null;
}

export function classifyEmail({ from, fromName, subject, projectClients = [] }) {
  const addr = (from || '').toLowerCase();
  const subj = subject || '';

  // 1. GitHub
  if (GITHUB_DOMAINS.test(addr) || GITHUB_KEYWORDS.test(subj)) return 'github';

  // 2. Calendar
  if (CALENDAR_DOMAINS.test(addr) || CALENDAR_KEYWORDS.test(subj)) return 'calendar';

  // 3. Expenses (finance senders / keywords) — checked before clients so that
  //    a Stripe receipt for an Acme charge stays in "expenses" not "clients/acme"
  if (FINANCE_DOMAINS.test(addr) || FINANCE_KEYWORDS.test(subj)) return 'expenses';

  // 4. Client match — ONLY against clients the user has actually created a project for.
  //    No auto-folder for unknown domains; those drop into `other`. Keeps the
  //    sidebar clean and prevents one-off vendor folders from cluttering the tree.
  const matched = clientMatch(addr, fromName, projectClients);
  if (matched) return `clients/${matched}`;

  return 'other';
}

export const FOLDER_ORDER = ['clients', 'expenses', 'github', 'calendar', 'other'];
