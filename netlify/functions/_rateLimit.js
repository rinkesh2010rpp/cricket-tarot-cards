// Shared request throttling for the functions that call Groq (reading, speak, transcribe).
// Backed by Netlify Blobs so counts persist across invocations -- an in-memory counter would
// reset on every cold start and do nothing to stop a sustained burst. Two limits stack: a
// per-IP window (stops one client from hammering an endpoint) and a site-wide daily budget
// (a backstop against a spread-out flood or a runaway client loop, regardless of IP).
const { getStore } = require("@netlify/blobs");

function clientIp(event) {
  const header = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "";
  return header.split(",")[0].trim() || "unknown";
}

async function bump(store, key, limit, windowMs) {
  const bucket = `${key}:${Math.floor(Date.now() / windowMs)}`;
  const current = parseInt((await store.get(bucket)) || "0", 10);
  if (current >= limit) return false;
  await store.set(bucket, String(current + 1));
  return true;
}

// scope namespaces the buckets per function, so a burst against one endpoint doesn't eat
// another endpoint's budget.
//
// Fails open: if Blobs isn't reachable (e.g. running outside a linked Netlify context) this
// logs and lets the request through rather than taking the whole app down over a throttle that
// is meant to be a secondary safeguard, not the primary correctness path.
async function checkRateLimit(event, scope, { perIpLimit, perIpWindowMs, globalLimit, globalWindowMs }) {
  try {
    const store = getStore("rate-limits");
    const ip = clientIp(event);

    const okIp = await bump(store, `ip:${scope}:${ip}`, perIpLimit, perIpWindowMs);
    if (!okIp) {
      return { allowed: false, error: "Too many requests in a short span -- take a short breather and try again in a few minutes." };
    }

    const okGlobal = await bump(store, `global:${scope}`, globalLimit, globalWindowMs);
    if (!okGlobal) {
      return { allowed: false, error: "The Reader is resting -- this app has hit its request budget for today. Please try again later." };
    }

    return { allowed: true };
  } catch (err) {
    console.error(`Rate limit check failed for scope "${scope}", allowing request through:`, err.message);
    return { allowed: true };
  }
}

module.exports = { checkRateLimit };
