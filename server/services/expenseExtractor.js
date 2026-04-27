// Tiny one-shot Gemini call (via Gemini's OpenAI-compatible endpoint).
// Given an email body, returns { vendor, amount, currency, date, category, confidence, reasoning }.
// Falls back to a regex extractor if GEMINI_API_KEY is missing.

import axios from 'axios';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MODEL = 'gemini-2.5-flash';

const SYSTEM = `You are an expense extractor. Read the email and reply with ONE JSON object only:
{
  "vendor": "string (company that charged the user)",
  "amount": number,
  "currency": "USD" | "INR" | "EUR" | "GBP" | other ISO code,
  "date":   "YYYY-MM-DD",
  "category": one of: "Software" | "Hardware" | "Hosting & infra" | "Subcontractor" | "Travel" | "Meals" | "Office" | "Marketing" | "Taxes & fees" | "Other",
  "confidence": "high" | "medium" | "low",
  "reasoning": "one short sentence"
}
Rules:
- If the email is NOT an expense/receipt/payment confirmation, return {"isExpense": false, "reasoning": "why"}.
- Use the email's send date if no explicit transaction date is in the body.
- amount must be a number (no currency symbols, no commas).
- Never wrap your reply in markdown fences.`;

function regexFallback({ from, fromAddress, subject, body, date }) {
  // Very rough — only used when Gemini isn't available. Pulls the first plausible amount.
  const amountMatch = (body || subject || '').match(/(?:\$|₹|USD|INR|EUR|GBP)\s*([\d,]+(?:\.\d{1,2})?)/i)
    || (body || '').match(/\b([\d,]+\.\d{2})\b/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  const vendorGuess = (from || fromAddress || '').replace(/<.*>/, '').trim() || 'Unknown';
  return {
    vendor: vendorGuess,
    amount,
    currency: /₹/.test(body || '') ? 'INR' : 'USD',
    date: (date || new Date().toISOString()).slice(0, 10),
    category: 'Other',
    confidence: amount ? 'low' : 'low',
    reasoning: 'Heuristic fallback (no LLM key configured).',
  };
}

export async function extractExpenseFromEmail(emailMeta) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return regexFallback(emailMeta);

  const userPrompt = `From: ${emailMeta.from} <${emailMeta.fromAddress}>
Subject: ${emailMeta.subject}
Date: ${emailMeta.date || ''}

Body:
${(emailMeta.body || '').slice(0, 4500)}`;

  try {
    const r = await axios.post(`${GEMINI_BASE}/chat/completions`, {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 25000,
    });

    const text = r.data?.choices?.[0]?.message?.content?.trim() || '{}';
    // Strip accidental code fences just in case.
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.isExpense === false) return { isExpense: false, ...parsed };
    return {
      vendor: String(parsed.vendor || '').trim() || (emailMeta.from || 'Unknown'),
      amount: Number(parsed.amount) || 0,
      currency: parsed.currency || 'USD',
      date: parsed.date || (emailMeta.date || new Date().toISOString()).slice(0, 10),
      category: parsed.category || 'Other',
      confidence: parsed.confidence || 'medium',
      reasoning: parsed.reasoning || '',
    };
  } catch (e) {
    return { ...regexFallback(emailMeta), reasoning: `Gemini fallback: ${e.message}` };
  }
}
