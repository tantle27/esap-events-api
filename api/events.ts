import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

// Allowed frontends
const ORIGINS = new Set([
  "https://embedded-purdue.github.io",
  "http://localhost:3000",
]);

// --- helpers ---
function allowCors(req: VercelRequest, res: VercelResponse) {
  const origin = String(req.headers.origin || "");
  if (ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function assertEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function calendarClient() {
  const email = assertEnv("GOOGLE_SA_EMAIL");
  const rawKey = assertEnv("GOOGLE_SA_PRIVATE_KEY");
  const key = rawKey.replace(/\\n/g, "\n"); // keep \n in Vercel env
  const auth = new google.auth.JWT(
    email,
    undefined,
    key,
    ["https://www.googleapis.com/auth/calendar.events"]
  );
  return google.calendar({ version: "v3", auth });
}

// --- handler ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  // Simple health check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/events", version: 1 });
  }

  if (req.method !== "POST") return res.status(405).send("Use POST");

  try {
    const CALENDAR_ID = assertEnv("CALENDAR_ID");
    const TZ = process.env.TIMEZONE || "America/Indiana/Indianapolis";

    const { title, start, end, location, desc } = (req.body ?? {}) as {
      title?: string;
      start?: string; // ISO 8601
      end?: string;   // ISO 8601
      location?: string;
      desc?: string;
    };

    if (!title || !start || !end) {
      return res.status(400).send("Missing title/start/end");
    }

    const cal = calendarClient();
    const inserted = await cal.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: title,
        description: desc,
        location,
        start: { dateTime: new Date(start).toISOString(), timeZone: TZ },
        end:   { dateTime: new Date(end).toISOString(),   timeZone: TZ },
      },
    });

    return res.status(200).json({
      id: inserted.data.id,
      htmlLink: inserted.data.htmlLink,
    });
  } catch (err: any) {
    console.error("Create event failed:", err?.response?.data || err);
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      "Internal error";
    return res.status(500).send(msg);
  }
}