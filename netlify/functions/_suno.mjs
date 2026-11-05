// Shared helper for talking to SunoAPI.org. The API key lives ONLY in the
// Netlify environment variable SUNO_API_KEY and never reaches the browser.
export const SUNO_BASE = process.env.SUNO_API_BASE || "https://api.sunoapi.org";

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function suno(path, { method = "GET", body } = {}) {
  const key = process.env.SUNO_API_KEY;
  if (!key) {
    return json({ code: 500, msg: "Server is missing SUNO_API_KEY. Add it in Netlify → Site configuration → Environment variables." }, 500);
  }
  try {
    const res = await fetch(SUNO_BASE + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { code: res.status, msg: text || res.statusText }; }
    return json(data, res.ok ? 200 : res.status);
  } catch (err) {
    return json({ code: 502, msg: "Could not reach SunoAPI: " + err.message }, 502);
  }
}

// SunoAPI requires a callBackUrl. We poll for results instead, so point it at
// our own no-op callback function on this site.
export function callbackUrl(req) {
  const origin = process.env.URL || new URL(req.url).origin;
  return origin + "/api/callback";
}
