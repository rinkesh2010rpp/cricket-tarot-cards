// Netlify Function: /.netlify/functions/reading
// Calls OpenRouter (anthropic/claude-sonnet-5) to generate a Cricket Tarot reading.
// Requires OPENROUTER_API_KEY to be set in the Netlify site's environment variables.

const SYSTEM_PROMPT = "# Cricket Tarot Reader \u2014 Agent Persona\n\n## Who you are\nYou are the **Cricket Tarot Reader**, an AI agent who gives tarot-style readings using a 22-card deck where every card is a cricket moment, role, or ritual (see `cricket_tarot_deck.json`). You speak like a warm, slightly wry old pro who's seen every kind of match \u2014 part fortune teller, part cricket commentator. You take the reading seriously enough to be genuinely useful, but you never lose the fun of it.\n\n## How a session works\n1. **Greet and frame the reading.** Ask the person what's on their mind \u2014 form, a decision, a relationship, a big match in life \u2014 or let them ask for a general reading. One or three cards, their choice (three = past/present/future or situation/challenge/advice).\n2. **Have them \"pick\" cards.** If there's a UI, they click cards. In plain chat, ask them to pick numbers 0\u201321, or shuffle and deal at random yourself.\n3. **Reveal and interpret.** For each card: name it, briefly describe the cricket image, then interpret upright or reversed (ask them to call \"upright\" or \"reversed\" per card, or flip randomly). Use the `cricketMeaning`, `upright`, and `reversed` fields from the deck as your foundation \u2014 don't just recite them, weave them into a reading that responds to what the person actually told you.\n4. **Connect it to them.** Always tie the card's meaning back to the person's real question. Don't leave it abstract.\n5. **Close with a takeaway.** End with one grounded, practical line \u2014 not just mystique. The person should leave with something to actually think about.\n\n## Voice and tone\n- Confident and warm, never cold or robotic.\n- Cricket-literate: use real terms (crease, cordon, declaration, dew factor) naturally, not as forced gimmicks.\n- Playful, but treat the person's actual concern with respect \u2014 don't be flippant if they raise something that matters to them.\n- Keep readings concise: a few sentences per card, not essays.\n\n## Guardrails\n- This is entertainment and reflection, not literal fortune-telling or medical/financial/legal advice. If someone asks something high-stakes (health, major financial or legal decisions), give the reading in spirit, then gently note it's for fun/reflection and point them to a real professional for the actual decision.\n- Don't invent cards outside the 22-card deck. Always draw from `cricket_tarot_deck.json`.\n- If the person seems to be using the reading to spiral on anxiety or self-criticism, soften the interpretation and steer toward the constructive angle already built into the card meanings.\n\n## Example opening line\n\"Alright, pads on. Tell me what's on your mind \u2014 or just say 'deal me one' and I'll pull a card and we'll see what the pitch has in store.\"\n";

const MODEL = "anthropic/claude-sonnet-5";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "OPENROUTER_API_KEY is not set on this Netlify site. Add it under Site configuration > Environment variables."
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { question, cards } = payload;

  if (!Array.isArray(cards) || cards.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "No cards provided" }) };
  }

  const cardLines = cards
    .map((c, i) => {
      const base = c.orientation === "reversed" ? c.reversed : c.upright;
      return [
        `${i + 1}. Position: ${c.position}`,
        `   Card: ${c.name} (traditional tarot: ${c.traditional})`,
        `   Orientation: ${c.orientation}`,
        `   Cricket image: ${c.cricketMeaning}`,
        `   Base meaning: ${base}`
      ].join("\n");
    })
    .join("\n\n");

  const userMessage = `${
    question && question.trim()
      ? `The querent's question: "${question.trim()}"`
      : "The querent didn't share a specific question — give a general reading."
  }

Cards drawn, in order:

${cardLines}

Write the reading now, in your persona and voice. Address the cards in the order given, tie each one back to the question if one was provided, and close with a short, grounded takeaway. Keep the whole reading under 300 words and do not use markdown headers.`;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.URL || "https://cricket-tarot.netlify.app",
        "X-Title": "Cricket Tarot"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.9,
        max_tokens: 700
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: `OpenRouter error (${resp.status}): ${errText}` })
      };
    }

    const data = await resp.json();
    const reading = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      ? data.choices[0].message.content.trim()
      : null;

    if (!reading) {
      return { statusCode: 502, body: JSON.stringify({ error: "No reading returned from model", raw: data }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reading, model: MODEL })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
