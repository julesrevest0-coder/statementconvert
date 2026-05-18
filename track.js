export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).end();
  }

  const { event: evtName, props = {}, url, ts } = payload;
  const ALLOWED_KEYS = ['lang','ext','size_kb','tx_count','format','code','is_demo','destination','plan','price_id'];
  const safeProps = {};
  for (const k of ALLOWED_KEYS) {
    if (props[k] !== undefined) safeProps[k] = props[k];
  }

  console.log(JSON.stringify({
    t: 'track', evt: evtName || 'unknown',
    props: safeProps, url: url || '/',
    client_ts: ts || null, server_ts: Date.now(),
  }));

  return res.status(204).end();
}
