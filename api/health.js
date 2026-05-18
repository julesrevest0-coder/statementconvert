export default function handler(req, res) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return res.status(hasKey ? 200 : 503).json({
    ok: hasKey,
    service: 'StatementConvert',
    api_key_configured: hasKey,
    ts: new Date().toISOString(),
  });
}
