/**
 * StatementConvert — /api/convert
 * Vercel Serverless Function (Node.js)
 */

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME = [
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const SYSTEM_PROMPT = `You are a bank statement parser. Your only job is to extract transactions from the document provided and return them as structured JSON.

Rules:
- Extract ALL transactions visible in the document.
- Return ONLY valid JSON, nothing else — no markdown, no explanation, no code fences.
- If the document is not a bank statement or you cannot extract transactions, return: {"error":"not_a_statement"}
- If the document is unreadable or corrupted, return: {"error":"unreadable"}
- Dates: use ISO format YYYY-MM-DD when possible, otherwise keep the original format exactly as printed.
- Amounts: positive numbers for credits/income, negative numbers for debits/expenses. Numbers only, no currency symbols.
- Balance: running balance after each transaction, if available. null if not present.
- Category: best-guess category from this list: Income, Groceries, Transport, Housing, Utilities, Subscriptions, Health, Dining, Shopping, Travel, Entertainment, Transfer, Fees, Other.
- Description: clean the raw description, remove excess codes/spaces, keep it readable.

Return format (JSON only):
{
  "currency": "EUR",
  "account_name": "...",
  "statement_period": "...",
  "transactions": [
    {
      "date": "2024-03-01",
      "description": "Netflix",
      "amount": -15.99,
      "balance": 4284.01,
      "category": "Subscriptions"
    }
  ]
}`;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_misconfigured', message: 'API key not configured.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const { file, mimeType, filename } = body;

  if (!file || !mimeType) {
    return res.status(400).json({ error: 'missing_fields', message: 'file and mimeType are required.' });
  }

  if (!ALLOWED_MIME.includes(mimeType)) {
    return res.status(415).json({
      error: 'unsupported_format',
      message: `Format not supported: ${mimeType}. Supported: PDF, CSV, Excel, JPG, PNG.`,
    });
  }

  const byteLength = Buffer.byteLength(file, 'base64');
  if (byteLength > MAX_BYTES) {
    return res.status(413).json({
      error: 'file_too_large',
      message: 'File exceeds 8MB limit. Try a smaller file or split it.',
    });
  }

  const isTextFormat = mimeType === 'text/csv' || mimeType === 'text/plain';
  let userContent;

  if (isTextFormat) {
    const text = Buffer.from(file, 'base64').toString('utf-8');
    userContent = [{ type: 'text', text: `Extract all transactions from this bank statement (${filename || 'file'}):\n\n${text}` }];
  } else if (mimeType === 'application/pdf') {
    userContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file } },
      { type: 'text', text: `Extract all transactions from this bank statement PDF (${filename || 'document'}).` },
    ];
  } else {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: file } },
      { type: 'text', text: `Extract all transactions from this bank statement image (${filename || 'image'}).` },
    ];
  }

  let claudeResponse;
  try {
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!apiResponse.ok) {
      if (apiResponse.status === 429) {
        return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Please wait and try again.' });
      }
      throw new Error(`Claude API ${apiResponse.status}`);
    }

    claudeResponse = await apiResponse.json();
  } catch (err) {
    console.error('[convert] error:', err);
    return res.status(502).json({ error: 'extraction_failed', message: 'Could not reach the extraction service. Please try again.' });
  }

  const rawText = claudeResponse.content?.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!rawText) return res.status(502).json({ error: 'empty_response' });

  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return res.status(422).json({ error: 'parse_failed', message: 'Could not parse the extracted data. Please try a different file.' });
  }

  if (parsed.error) {
    const messages = {
      not_a_statement: 'This file does not appear to be a bank statement.',
      unreadable: 'The file is unreadable or corrupted. Try re-exporting from your bank.',
    };
    return res.status(422).json({ error: parsed.error, message: messages[parsed.error] || 'Could not extract transactions.' });
  }

  if (!Array.isArray(parsed.transactions) || parsed.transactions.length === 0) {
    return res.status(422).json({ error: 'no_transactions', message: 'No transactions found in this file.' });
  }

  console.log(`[convert] OK — ${parsed.transactions.length} transactions from ${filename || 'file'}`);

  return res.status(200).json({
    ok: true,
    currency: parsed.currency || 'EUR',
    account_name: parsed.account_name || null,
    statement_period: parsed.statement_period || null,
    transaction_count: parsed.transactions.length,
    transactions: parsed.transactions,
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
