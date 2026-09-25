import { config } from "./config.js";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT_TEMPLATE = `You are extracting calendar-worthy events from a single message posted in a school communication app (ClassDojo, ClassCharts, or MyChildAtSchool).

We only care about events with a specific date that a parent would plausibly want on their calendar (trips, deadlines, meetings, non-uniform days, parents' evenings, deposit due dates etc). Ignore general news, newsletters, praise posts, photo updates, and policy reminders with no date.

IMPORTANT: a single message can contain more than one calendar-worthy date. A common pattern is a payment/response DEADLINE mentioned separately from the actual EVENT DATE itself (e.g. "pay by 27th November" for a trip that happens "14th December"). When that happens, extract them as two SEPARATE entries -- one for the deadline, one for the event -- rather than picking only one. Do not merge them into a single entry or silently prefer one date over the other.

In longer messages (a full letter, not just a short announcement), the event's actual date is often stated in a separate sentence from the deadline, sometimes many paragraphs apart, and the year may only be given once, earlier in the message, rather than repeated next to the specific day ("Year 4 will visit in February 2027" in one paragraph, then later "from Monday 22nd to Wednesday 24th February" with no year restated). Read the whole message for this pattern rather than only the sentence containing the deadline -- a long, detailed letter about a trip almost always has the trip's own date embedded somewhere, separate from when to pay for it. When an event spans more than one day, use "end_date" for a single entry covering that range, rather than creating separate entries for the start and end.

Resolve relative or year-less dates ("next Wednesday", "Friday, September 25") using post_date as the anchor when it's known. If post_date is "unknown", use today instead -- never guess a year from general knowledge, since you don't reliably know the real current date otherwise.

Return ONLY a JSON object, no other text:

{
  "events": [
    {
      "date": string,             // ISO 8601 YYYY-MM-DD, resolved per the anchor-date rule above
      "end_date": string or null,
      "child_name": string or null,  // if household_children is known and the message clearly refers to one of them by name, use that exact name
      "class_name": string or null,  // null if the message is school-wide rather than tied to one class
      "year_group": string or null,
      "category": one of ["trip", "deadline", "payment", "meeting", "non_uniform", "club", "other"],
      "summary": string,          // one plain sentence, under 20 words, describing THIS specific date/entry (not the whole message)
      "confidence": number        // 0-100. Score conservatively:
                                   //   - below 60 if post_date was unknown and the date had to be resolved against today instead
                                   //   - below 60 if the date required inferring from a relative phrase and the anchor date itself is uncertain
                                   //   - below 70 if whether this actually applies is CONDITIONAL on something about this specific child/household that can't be verified from the message alone (e.g. "if your child normally brings a packed lunch...", "if your child hasn't returned their reading book..."). A clear date isn't enough on its own here -- the relevance itself is uncertain, which matters as much as the date being certain.
                                   //   - below 80 if ANY field required guessing rather than being explicitly stated
                                   //   - only 90+ if the date, what the event actually is, AND that it unconditionally applies are all stated plainly
    }
  ]
}

If the message has no calendar-worthy date at all, return {"events": []}.
If multiple children are named for one entry, set child_name to null and mention them in that entry's summary.

post_date: {{POST_DATE}}
today: {{TODAY}}
source_app: {{SOURCE}}
poster: {{POSTER}}
class_context: {{CLASS_CONTEXT}}
household_children: {{HOUSEHOLD_CHILDREN}}

Message:
"""
{{TEXT}}
"""`;

export async function classifyItem({ text, source, poster, classContext, postDate }) {
  const prompt = PROMPT_TEMPLATE.replace("{{POST_DATE}}", postDate || "unknown")
    .replace("{{TODAY}}", new Date().toISOString().slice(0, 10))
    .replace("{{SOURCE}}", source)
    .replace("{{POSTER}}", poster || "unknown")
    .replace("{{CLASS_CONTEXT}}", classContext || "unknown")
    .replace("{{HOUSEHOLD_CHILDREN}}", config.householdChildren?.join(", ") || "unknown")
    .replace("{{TEXT}}", text);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s hard cap

  let res;
  try {
    res = await fetch(`${GEMINI_URL}?key=${config.geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[classify] Gemini request timed out after 30s -- skipping this item for now.");
      return { events: [], parse_error: true };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 429) {
    console.warn("[classify] Gemini free-tier rate limit hit -- skipping this item for now.");
    return { events: [], parse_error: true };
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[classify] Gemini API error ${res.status}:`, errText);
    return { events: [], parse_error: true };
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.events)) throw new Error("Response missing 'events' array");
    return parsed;
  } catch (err) {
    console.error("[classify] Failed to parse model output:", raw);
    return { events: [], parse_error: true };
  }
}
