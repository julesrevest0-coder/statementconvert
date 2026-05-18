export default function handler(req, res) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return res.status(hasKey ? 200 : 503).json({
    ok: hasKey,
    service: 'StatementConvert',
    version: '1.0.0-mvp',
    api_key_configured: hasKey,
    ts: new Date().toISOString(),
  });
}
