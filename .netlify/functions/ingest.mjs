// Receives a bank SMS / payment-app notification from your phone (MacroDroid, Tasker…)
// and drops it into the `pending_transactions` table. The app parses it and shows it
// in the Inbox tab for you to approve — nothing is added to your balances automatically.
//
// Netlify environment variables (Site settings → Environment variables):
//   INGEST_KEY            a long random secret; the phone sends it in the x-ingest-key header
//   SUPABASE_URL          same value as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_KEY  Supabase → Project Settings → API → service_role key (keep private!)

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// constant-time string compare
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Accepts raw text, JSON ({ text | message | raw_text | body }), or a form post.
async function readMessage(req) {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  const raw = await req.text();
  let text = raw;
  let sender = "";
  let source = "sms";
  if (type.includes("json")) {
    try {
      const j = JSON.parse(raw);
      text = j.raw_text ?? j.text ?? j.message ?? j.body ?? "";
      sender = j.sender ?? j.from ?? "";
      source = j.source ?? source;
    } catch { text = raw; /* not valid JSON — treat as plain text */ }
  } else if (type.includes("x-www-form-urlencoded")) {
    // Some apps send plain text under this type by default; use the fields if present, else the raw body.
    const p = new URLSearchParams(raw);
    const field = p.get("raw_text") || p.get("text") || p.get("message") || p.get("body");
    text = field || raw;
    sender = p.get("sender") || p.get("from") || "";
    source = p.get("source") || source;
  }
  return { text: String(text).replace(/\u0000/g, "").trim().slice(0, 2000), sender: String(sender).slice(0, 60), source: String(source).slice(0, 20) };
}

export default async (req) => {
  const secret = process.env.INGEST_KEY;
  const supaUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const configured = !!(secret && supaUrl && serviceKey);
  const url = new URL(req.url);
  const given = req.headers.get("x-ingest-key") || url.searchParams.get("key") || "";

  // Connection check: open  <this address>?key=YOUR_SECRET  in the phone's browser.
  // Without the key it only says whether the server is configured; it never reveals anything else.
  if (req.method === "GET") {
    const out = { ok: true, configured };
    if (given) {
      out.keyOk = configured && safeEqual(given, secret);
      if (out.keyOk) {
        try {
          const r = await fetch(`${supaUrl}/rest/v1/pending_transactions?select=id&limit=1`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
          out.table = r.ok ? "ready" : r.status === 404 ? "missing — run SUPABASE_INBOX.sql" : `error ${r.status}`;
        } catch { out.table = "can't reach Supabase — check SUPABASE_URL"; }
      }
    }
    return json(200, out);
  }

  if (req.method !== "POST") return json(405, { error: "POST or GET only" });
  if (!configured) return json(500, { error: "Server is not configured (missing environment variables)." });
  if (!safeEqual(given, secret)) return json(401, { error: "Wrong or missing key." });

  const { text, sender, source } = await readMessage(req);
  if (!text) return json(400, { error: "Empty message." });

  // Keep the database clean: only store messages that look like a payment, never OTPs.
  const hasAmount = /(?:rs\.?|inr|₹)\s*[\d,]+/i.test(text) || /(?:debited|credited)\s+(?:by|with)\s+[\d,]+/i.test(text);
  const isOtp = /\botp\b|one[\s-]?time\s+password|verification code/i.test(text);
  if (!hasAmount || isOtp) return json(200, { stored: false, reason: isOtp ? "otp" : "no amount found in message", received: text.slice(0, 80) });

  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };

  // The same SMS can trigger the phone twice — skip an identical message from the last 90 seconds.
  const since = new Date(Date.now() - 90_000).toISOString();
  const dupRes = await fetch(
    `${supaUrl}/rest/v1/pending_transactions?select=id&raw_text=eq.${encodeURIComponent(text)}&created_at=gte.${encodeURIComponent(since)}&limit=1`,
    { headers }
  );
  if (dupRes.ok && (await dupRes.json()).length) return json(200, { stored: false, reason: "duplicate" });

  const ins = await fetch(`${supaUrl}/rest/v1/pending_transactions`, {
    method: "POST",
    headers: { ...headers, prefer: "return=minimal" },
    body: JSON.stringify({ raw_text: text, sender, source }),
  });
  if (!ins.ok) return json(502, { error: "Couldn't save the message.", detail: (await ins.text()).slice(0, 200) });
  return json(200, { stored: true });
};
