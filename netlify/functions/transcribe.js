// Netlify Function: /.netlify/functions/transcribe
// Speech-to-text for the mic button: the client records audio in the browser and posts it
// here as base64; this function forwards it to Groq's Whisper transcription endpoint and
// returns plain text for the composer.
// Requires GROQ_API_KEY to be set in Netlify, or in a local .env file for local development.

try {
  require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
} catch (err) {
  // dotenv is optional at runtime on Netlify; Netlify injects environment variables directly.
}

const MODEL = "whisper-large-v3-turbo";

function extensionFor(mimeType) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
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

  const { audio, mimeType } = payload;
  if (!audio || typeof audio !== "string") {
    return { statusCode: 400, body: JSON.stringify({ error: "audio (base64 string) is required" }) };
  }

  let buffer;
  try {
    buffer = Buffer.from(audio, "base64");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "audio must be valid base64" }) };
  }
  if (!buffer.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "audio was empty" }) };
  }

  const type = mimeType || "audio/webm";

  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type }), `speech.${extensionFor(type)}`);
    form.append("model", MODEL);
    form.append("response_format", "json");

    const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: `Groq error (${resp.status}): ${errText}` })
      };
    }

    const data = await resp.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: (data.text || "").trim() })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
