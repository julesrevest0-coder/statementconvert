const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['application/pdf','text/csv','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp'];
const SYSTEM_PROMPT = `You are a bank statement parser. Extract transactions and return ONLY valid JSON, nothing else.
Return format: {"currency":"EUR","account_name":"...","statement_period":"...","transactions":[{"date":"2024-03-01","description":"Netflix","amount":-15.99,"balance":4284.01,"category":"Subscriptions"}]}
If not a bank statement return: {"error":"not_a_statement"}
If unreadable return: {"error":"unreadable"}
Rules: positive amounts = credits, negative = debits. Category from: Income,Groceries,Transport,Housing,Utilities,Subscriptions,Health,Dining,Shopping,Travel,Entertainment,Transfer,Fees,Other`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(204).end();
  if (req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error:'server_misconfigured'});
  let body;
  try { body = typeof req.body==='string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({error:'invalid_json'}); }
  const {file, mimeType, filename} = body;
  if (!file||!mimeType) return res.status(400).json({error:'missing_fields'});
  if (!ALLOWED_MIME.includes(mimeType)) return res.status(415).json({error:'unsupported_format',message:`Format not supported: ${mimeType}`});
  if (Buffer.byteLength(file,'base64')>MAX_BYTES) return res.status(413).json({error:'file_too_large'});
  const isText = mimeType==='text/csv'||mimeType==='text/plain';
  let userContent;
  if (isText) { const text=Buffer.from(file,'base64').toString('utf-8'); userContent=[{type:'text',text:`Extract transactions from this bank statement:\n\n${text}`}]; }
  else if (mimeType==='application/pdf') { userContent=[{type:'document',source:{type:'base64',media_type:'application/pdf',data:file}},{type:'text',text:'Extract all transactions from this bank statement PDF.'}]; }
  else { userContent=[{type:'image',source:{type:'base64',media_type:mimeType,data:file}},{type:'text',text:'Extract all transactions from this bank statement image.'}]; }
  let claudeResponse;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-beta':'pdfs-2024-09-25'},body:JSON.stringify({model:'claude-opus-4-5',max_tokens:8000,system:SYSTEM_PROMPT,messages:[{role:'user',content:userContent}]})});
    if (!r.ok) { if (r.status===429) return res.status(429).json({error:'rate_limited',message:'Too many requests. Try again.'}); throw new Error(`API ${r.status}`); }
    claudeResponse = await r.json();
  } catch(err) { console.error(err); return res.status(502).json({error:'extraction_failed',message:'Could not reach extraction service.'}); }
  const rawText = claudeResponse.content?.filter(b=>b.type==='text').map(b=>b.text).join('');
  if (!rawText) return res.status(502).json({error:'empty_response'});
  let parsed;
  try { parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim()); }
  catch { return res.status(422).json({error:'parse_failed',message:'Could not parse extracted data.'}); }
  if (parsed.error) return res.status(422).json({error:parsed.error,message:parsed.error==='not_a_statement'?'Not a bank statement.':'File unreadable.'});
  if (!Array.isArray(parsed.transactions)||parsed.transactions.length===0) return res.status(422).json({error:'no_transactions',message:'No transactions found.'});
  return res.status(200).json({ok:true,currency:parsed.currency||'EUR',account_name:parsed.account_name||null,statement_period:parsed.statement_period||null,transaction_count:parsed.transactions.length,transactions:parsed.transactions});
}
export const config = {api:{bodyParser:{sizeLimit:'10mb'}}};
