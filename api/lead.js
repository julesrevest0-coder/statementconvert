const ALLOWED_ORIGINS = [
  'https://index-pied-three.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const email = String(body.email || '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        email,
        listIds: [2],
        updateEnabled: true,
        attributes: {
          SOURCE: 'StatementConvert',
          DATE_INSCRIPTION: new Date().toISOString()
        }
      })
    });

    if (!brevoRes.ok) {
      const text = await brevoRes.text();
      console.error('Brevo error:', brevoRes.status, text);
      return res.status(502).json({ error: 'brevo_failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'lead_failed' });
  }
}
