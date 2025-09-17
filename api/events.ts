import { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

const ORIGINS = new Set([
  "https://embedded-purdue.github.io",
  "http://localhost:3000",
]);

function calendarClient() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SA_EMAIL!,
    undefined,
    String(process.env.GOOGLE_SA_PRIVATE_KEY!).replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar.events"]
  );
  return google.calendar({ version: "v3", auth: jwt });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = String(req.headers.origin || "");
  if (ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Use POST");

  try {
    const { title, start, end, location, desc } = req.body || {};
    if (!title || !start || !end) return res.status(400).send("Missing title/start/end");

    const cal = calendarClient();
    const inserted = await cal.events.insert({
      calendarId: process.env.CALENDAR_ID!,
      requestBody: {
        summary: title,
        description: desc,
        location,
        start: { dateTime: new Date(start).toISOString(), timeZone: process.env.TIMEZONE || "America/Indiana/Indianapolis" },
        end:   { dateTime: new Date(end).toISOString(),   timeZone: process.env.TIMEZONE || "America/Indiana/Indianapolis" },
      },
    });

    return res.status(200).json({ id: inserted.data.id, link: inserted.data.htmlLink });
  } catch (e: any) {
    return res.status(500).send(e.message || "error");
  }
}