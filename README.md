# Cricket Tarot

A conversational tarot reader for cricket fans. The deck has the full structure of a traditional tarot deck (78 cards), but every card is reimagined as a cricket moment, role or ritual. You talk to the Reader, it asks what's really going on, and when it's ready it has you draw cards and reads the scene they show. You can type or use the mic, and the Reader can speak its replies.

For fun and reflection only: not medical, legal or financial advice.

## How it works

```
public/index.html  ──POST──▶  /.netlify/functions/reading     ──▶  Groq chat (openai/gpt-oss-120b, draw_cards tool)
  (single page)    ──POST──▶  /.netlify/functions/transcribe  ──▶  Groq Whisper (whisper-large-v3-turbo)
                   ──POST──▶  /.netlify/functions/speak       ──▶  Groq Orpheus TTS (canopylabs/orpheus-v1-english)
```

- **No server-side conversation state.** The browser keeps the reading's history in memory and resends it every turn; `reading.js` prepends the system prompt and calls Groq. Refreshing the page or starting a New Reading clears it.
- **Card draws happen in the browser.** The model never picks cards. It calls the `draw_cards` tool (1–5 cards, with a label for each position), the page lets the user draw from the deck, picks upright or reversed (75% upright), and sends the real card data back as the tool result. Cards don't repeat within a reading.
- **Voice is optional.** The mic records up to 20 seconds and stops on its own after ~1.2 s of silence; the clip goes to `transcribe` and the text lands in the composer. Spoken replies send the Reader's text (capped at 2,000 characters) to `speak`, which returns WAV audio.

## Project layout

| Path | What it is |
|---|---|
| `public/index.html` | The whole frontend: landing page, chat, card table, voice, privacy modal. Plain HTML/CSS/JS, no build step. |
| `public/cricket_tarot_deck.json` | The deck, loaded by the page at startup |
| `netlify/functions/reading.js` | The Reader: system prompt, `draw_cards` tool, Groq chat call |
| `netlify/functions/transcribe.js` | Speech-to-text for the mic button |
| `netlify/functions/speak.js` | Text-to-speech for spoken replies |
| `netlify/functions/_rateLimit.js` | Shared rate limiter used by all three functions |
| `netlify.toml` | Netlify build and dev config |
| `.env.example` | Template for the local `.env` file |

## The deck

`cricket_tarot_deck.json` holds the 22 Major Arcana and 56 Minor Arcana. The four suits map to the traditional ones:

| Suit | Traditional | Theme |
|---|---|---|
| Bats | Wands | drive, ambition, momentum |
| Caps | Cups | emotion, relationships, belonging |
| Seam | Swords | mind and conflict |
| Stumps | Pentacles | graft and results |

Court cards are The Colt (Page), The Quick (Knight), The Senior Pro (Queen) and The Great (King). Every Minor Arcana card has its own name (e.g. "The Heavy Legs" for the Nine of Wands) rather than "Nine of Bats".

Each card has `id`, `name`, `traditional`, `keywords`, `cricketMeaning`, `upright` and `reversed`; Minor Arcana cards also have `suit` and `rank`. The system prompt tells the model to use exactly what the tool gives it and never invent a card or a meaning, so edits to the JSON are what the Reader will say.

## Running locally

Needs Node 18+ and the [Netlify CLI](https://docs.netlify.com/cli/get-started/).

```bash
npm install
cp .env.example .env   # then add your GROQ_API_KEY
netlify dev
```

The site and functions are served together at <http://localhost:8888>.

## Configuration

One environment variable:

| Variable | Used by | Notes |
|---|---|---|
| `GROQ_API_KEY` | all three functions | Set it in Netlify's environment variables for the deployed site. Locally, put it in a `.env` file at the repo root (gitignored); the functions load it with `dotenv`, which never overrides a value Netlify already provides. |

If it's missing, each function returns a 500 saying so.

**Spoken replies need a one-time step:** Groq's Orpheus TTS model requires the org admin to accept its terms in the [Groq playground](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english). Until then `speak` returns an error and spoken replies won't play.

## Function API

All three endpoints accept `POST` with a JSON body and return JSON. Anything else gets a 405.

| Endpoint | Request | Success (200) |
|---|---|---|
| `reading` | `{ "messages": [...] }`: the conversation so far, in OpenAI chat format (no system message; the function adds it) | `{ "message": {...}, "model": "openai/gpt-oss-120b" }`: the assistant message, which may contain `tool_calls` for `draw_cards` |
| `transcribe` | `{ "audio": "<base64>", "mimeType": "audio/webm" }`: `mimeType` is optional and defaults to `audio/webm` | `{ "text": "..." }` |
| `speak` | `{ "text": "..." }`: truncated to 2,000 characters | `{ "audio": "<base64>", "mimeType": "audio/wav" }` |

Errors come back as `{ "error": "..." }` with:

- **400** for a malformed body (bad JSON, `messages` not an array, missing `text` or `audio`, invalid base64)
- **413** from `transcribe` when the decoded audio is over 8 MB
- **429** when a rate limit is hit (see below)
- **500** when `GROQ_API_KEY` is missing or the request throws
- Groq's own status code, passed through, when the Groq call fails

`reading` calls Groq with `temperature: 0.9` and `max_tokens: 700`; the Orpheus voice is `hannah`. Both are constants at the top of their files.

## Rate limits

Every Groq call costs money and the site is public, so all three functions go through `_rateLimit.js` before calling Groq. Two limits stack, counted separately for each function:

| Limit | Value | Message when hit |
|---|---|---|
| Per IP | 40 requests per 15 minutes | "take a short breather…" |
| Site-wide | 1,500 requests per day | "The Reader is resting…" |

- Counts live in [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (store `rate-limits`), so they survive cold starts. Windows are fixed buckets, not sliding.
- IPs are stored only as a truncated SHA-256 hash.
- **It fails open.** If Blobs can't be reached (for example when running locally without a linked Netlify site), the check logs an error and lets the request through. It's a safeguard against abuse and runaway cost, not something the app depends on.
- The counter isn't atomic, so a burst of parallel requests can slip a little past a limit.

To change a limit, edit the numbers passed to `checkRateLimit` at the top of each function's handler.

## Deployment

Hosted on Netlify. `netlify.toml` publishes `public/` and bundles `netlify/functions/` with esbuild. There's no build step for the frontend.

## Privacy

The in-app "Privacy & data" note (in `index.html`) is the user-facing version. In short: no accounts, cookies or analytics; questions and replies go to Groq; mic audio goes to Groq for transcription and isn't kept; only hashed IPs are stored, for rate limiting; and the sound and voice on/off settings live in the browser's `localStorage`. If you change what the app collects or sends, update that note too.
