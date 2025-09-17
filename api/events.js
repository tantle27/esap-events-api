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

function mustEnv(name) {
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

export default async function handler(req, res) {
  allowCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/events", version: 1 });
  }
  if (req.method !== "POST") return res.status(405).send("Use POST");

  try {
    const CALENDAR_ID = mustEnv("CALENDAR_ID");
    const TZ = process.env.TIMEZONE || "America/Indiana/Indianapolis";

    const { title, start, end, location, desc } = req.body || {};
    if (!title || !start || !end) return res.status(400).send("Missing title/start/end");

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

    return res.status(200).json({ id: inserted.data.id, htmlLink: inserted.data.htmlLink });
  } catch (err) {
    console.error("Create event failed:", err?.response?.data || err);
    const msg = err?.response?.data?.error?.message || err?.message || "Internal error";
    return res.status(500).send(msg);
  }
}