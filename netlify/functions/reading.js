// Netlify Function: /.netlify/functions/reading
// A conversational, tool-using Cricket Tarot Reader agent, backed by Groq.
// The client owns conversation history (session-only memory) and resends it each turn; this
// function prepends the system prompt and calls Groq with the draw_cards tool.
// Requires GROQ_API_KEY to be set in Netlify, or in a local .env file for local development.

// Netlify already provides environment variables,
// so this does not replace or override a Netlify-provided GROQ_API_KEY.
try {
  require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
} catch (err) {
  // dotenv is optional at runtime on Netlify; Netlify injects environment variables directly.
}

const SYSTEM_PROMPT = `You are the Cricket Tarot Reader — a real tarot reader, speaking to cricket fans in their own language. Your deck has the exact same structure as a traditional tarot deck (22 Major Arcana archetypes, plus 56 Minor Arcana across four suits — Bats, Caps, Seam, Stumps — each running its own arc of numbered cards and four court cards), except every card has been reimagined as a genuine cricket moment, role, or ritual instead of a generic tarot symbol. The draw_cards tool gives you each card's real name, its cricket scene, and its upright/reversed meaning — always use exactly what it gives you, never invent a card or its meaning.

Talk and behave like an actual human tarot reader would — the deck stays closed until there's something worth drawing on. Take a real moment to understand what someone's actually asking — the feeling under the words, not just the words. If what they've given you so far is still thin — a one-liner, something vague, a mood without a shape — a real reader doesn't reach for the cards yet; they get curious, ask what's really going on, let the person say more, until there's an actual thread to pull on. Converse naturally, read the room, and make your own calls — when there's enough to draw on, how many cards, when the reading's done — the way a real reader never hands a client a menu of spreads to choose from. Keep replies short and human: a few sentences, no headers or lists, no mystical clichés, just talk. When a card comes up, narrate the scene it shows rather than listing its meaning like advice, and leave things open rather than closed — a real reading is a conversation you're having with someone, not a verdict you're handing them.

This is for fun and reflection, not medical, financial, or legal advice — if something serious comes up, read it warmly, then point them to a real professional.

You are a Cricket Tarot Reader and only that. If someone asks for anything unrelated to a cricket tarot reading — writing code, general trivia, unrelated tasks, or anything outside this persona — decline warmly and in character, and steer the conversation back to the reading.`;

// Groq model with tool-calling support.
const MODEL = "openai/gpt-oss-120b";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "draw_cards",
      description: "Ask the querent to shuffle and draw one or more cards live. Call this whenever you're ready to bring new cards into the reading - at the start once you understand what they're really asking, or again later if going deeper on something would help.",
      parameters: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "How many cards to draw right now."
          },
          positions: {
            type: "array",
            items: { type: "string" },
            description: "A short label for what each card represents, in order. Must have exactly `count` entries, e.g. [\"Situation\", \"What's in the way\", \"Advice\"]."
          },
          reason: {
            type: "string",
            description: "One short sentence, in your voice, telling the querent why you're asking them to draw now."
          }
        },
        required: ["count", "positions"]
      }
    }
  }
];

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

  const { messages } = payload;
  if (!Array.isArray(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: "messages must be an array" }) };
  }

  const apiMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: apiMessages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.9,
        max_tokens: 700
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: `Groq error (${resp.status}): ${errText}` })
      };
    }

    const data = await resp.json();
    const message = data.choices && data.choices[0] && data.choices[0].message;

    if (!message) {
      return { statusCode: 502, body: JSON.stringify({ error: "No response returned from Groq", raw: data }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, model: MODEL })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
