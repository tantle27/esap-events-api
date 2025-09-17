// api/events.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

const ORIGINS = new Set([
  "https://embedded-purdue.github.io",
  "http://localhost:3000",
]);

function allowCors(req: VercelRequest, res: VercelResponse) {
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

/** Normalize arbitrary RRULE-ish input to a clean "RRULE:FREQ=...;..." */
function normalizeRRule(line: string | undefined | null): string | null {
  if (!line) return null;
  let s = String(line).trim();
  // If it starts with RRULE (any spacing), strip the label keeping the body
  s = s.replace(/^RRULE\s*:/i, "");
  // Remove all whitespaces inside; RFC5545 parameters shouldn’t contain spaces
  s = s.replace(/\s+/g, "");
  if (!s.toUpperCase().startsWith("FREQ=")) return null;
  return `RRULE:${s.toUpperCase()}`;
}

/** Build EXDATE lines matching a TIMED DTSTART using TZID */
function buildTimedExDateLines(
  exDates: string[] | undefined,
  startLocal: string, // "YYYY-MM-DDTHH:mm[:ss]"
  tz: string
) {
  if (!exDates?.length) return [];
  const [, timePart = "00:00:00"] = startLocal.split("T");
  const hhmmss = timePart.length === 5 ? `${timePart}:00` : timePart; // ensure :ss

  const stamp = (d: string) =>
    `${d.replaceAll("-", "")}T${hhmmss.replaceAll(":", "")}`;

  return [`EXDATE;TZID=${tz}:${exDates.map(stamp).join(",")}`];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    allowCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method === "GET") return res.status(200).json({ ok: true, route: "/api/events", version: 4 });
    if (req.method !== "POST") return res.status(405).send("Use POST");

    const CALENDAR_ID = mustEnv("CALENDAR_ID");
    const TZ = process.env.TIMEZONE || "America/Indiana/Indianapolis";

    const {
      title, start, end, location, desc,
      recurrence, exDates,
    } = (req.body ?? {}) as {
      title?: string;
      start?: string;  // local "YYYY-MM-DDTHH:mm[:ss]"
      end?: string;    // local "YYYY-MM-DDTHH:mm[:ss]"
      location?: string;
      desc?: string;
      recurrence?: string | string[]; // client may send string or array
      exDates?: string[];             // ["YYYY-MM-DD", ...]
    };

    if (!title || !start || !end) return res.status(400).send("Missing title/start/end");

    const cal = calendarClient();

    // Canonicalize recurrence into an array of cleaned RRULE lines
    const recurrenceLines: string[] = [];
    const incoming = Array.isArray(recurrence) ? recurrence : [recurrence];
    for (const r of incoming) {
      const norm = normalizeRRule(r as string);
      if (norm) recurrenceLines.push(norm);
    }

    // Add EXDATEs for timed events (wall-clock)
    recurrenceLines.push(...buildTimedExDateLines(exDates, start, TZ));

    const inserted = await cal.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: title,
        description: desc,
        location,
        // pass local wall-clock + timeZone (do not convert to Z)
        start: { dateTime: start, timeZone: TZ },
        end:   { dateTime: end,   timeZone: TZ },
        ...(recurrenceLines.length ? { recurrence: recurrenceLines } : {}),
      },
    });

    return res.status(200).json({ id: inserted.data.id, htmlLink: inserted.data.htmlLink });
  } catch (err: any) {
    console.error("Create event failed:", err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || "Internal error";
    return res.status(500).send(msg);
  }
}