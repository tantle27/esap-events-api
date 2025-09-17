// pages/api/events.ts (or the equivalent route)
import { google } from "googleapis";

const ORIGINS = new Set([
  "https://embedded-purdue.github.io",
  "http://localhost:3000",
]);

function allowCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function calendarClient() {
  const email = mustEnv("GOOGLE_SA_EMAIL");
  const key = mustEnv("GOOGLE_SA_PRIVATE_KEY").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT(
    email,
    undefined,
    key,
    ["https://www.googleapis.com/auth/calendar.events"]
  );
  return google.calendar({ version: "v3", auth });
}

/** Accepts either:
 *  - string: "2025-09-21T16:00:00.000Z" (any Date-parseable string)
 *  - object: { dateTime: string, timeZone?: string }
 * Returns { dateTime, timeZone }
 */
function normalizeDateInput(input: any, fallbackTZ: string) {
  if (input && typeof input === "object" && "dateTime" in input) {
    const dateTime = String(input.dateTime);
    const timeZone = String(input.timeZone || fallbackTZ);
    if (!dateTime) throw new Error("Invalid dateTime");
    return { dateTime, timeZone };
  }
  if (typeof input === "string") {
    const d = new Date(input);
    if (isNaN(d.getTime())) throw new Error("Invalid time value");
    return { dateTime: d.toISOString(), timeZone: fallbackTZ };
  }
  throw new Error("Invalid time value");
}

export default async function handler(req, res) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/events", version: 2 });
  }
  if (req.method !== "POST") return res.status(405).send("Use POST");

  try {
    const CALENDAR_ID = mustEnv("CALENDAR_ID");
    const DEFAULT_TZ = process.env.TIMEZONE || "America/Indiana/Indianapolis";

    const body = req.body || {};
    const { title, location, desc } = body;
    if (!title || !body.start || !body.end) {
      return res.status(400).send("Missing title/start/end");
    }

    // accept both old and new shapes
    const start = normalizeDateInput(body.start, DEFAULT_TZ);
    const end   = normalizeDateInput(body.end,   DEFAULT_TZ);

    // optional: pass-through Google RRULE format
    const recurrence: string[] = Array.isArray(body.recurrence) ? body.recurrence : [];

    const cal = calendarClient();
    const inserted = await cal.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: title,
        description: desc,
        location,
        start,   // { dateTime, timeZone }
        end,     // { dateTime, timeZone }
        recurrence, // e.g. ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20251222T045959Z"]
      },
    });

    return res.status(200).json({ id: inserted.data.id, htmlLink: inserted.data.htmlLink });
  } catch (err) {
    console.error("Create event failed:", err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || "Internal error";
    return res.status(500).send(msg);
  }
}