// Netlify Function: /.netlify/functions/speak
// Text-to-speech for spoken replies: the client posts the Reader's latest reply text here,
// this function calls Groq's Orpheus TTS endpoint, and returns base64 audio for the client to play.
// Requires GROQ_API_KEY to be set in Netlify, or in a local .env file for local development.
// The canopylabs/orpheus-v1-english model requires one-time terms acceptance by the org admin at
// https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english before this will work.

try {
  require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
} catch (err) {
  // dotenv is optional at runtime on Netlify; Netlify injects environment variables directly.
}

const { checkRateLimit } = require("./_rateLimit");

const MODEL = "canopylabs/orpheus-v1-english";
const VOICE = "hannah";
const MAX_INPUT_CHARS = 2000;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const rateLimit = await checkRateLimit(event, "speak", {
    perIpLimit: 40, perIpWindowMs: 15 * 60 * 1000,
    globalLimit: 1500, globalWindowMs: 24 * 60 * 60 * 1000
  });
  if (!rateLimit.allowed) {
    return { statusCode: 429, body: JSON.stringify({ error: rateLimit.error }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "GROQ_API_KEY is not set. Add it to your local .env file for local development or to Netlify Environment variables for deployment."
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { text } = payload;
  if (!text || typeof text !== "string" || !text.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "text is required" }) };
  }

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: text.trim().slice(0, MAX_INPUT_CHARS),
        response_format: "wav"
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: `Groq error (${resp.status}): ${errText}` })
      };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: base64, mimeType: "audio/wav" })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
