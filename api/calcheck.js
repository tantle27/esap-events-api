import { google } from "googleapis";

function mustEnv(n) {
  const v = process.env[n];
  if (!v) throw new Error(`Missing env: ${n}`);
  return v;
}

function cal() {
  const auth = new google.auth.JWT(
    mustEnv("GOOGLE_SA_EMAIL"),
    undefined,
    mustEnv("GOOGLE_SA_PRIVATE_KEY").replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar"]
  );
  return google.calendar({ version: "v3", auth });
}

export default async function handler(req, res) {
  try {
    const CALENDAR_ID = mustEnv("CALENDAR_ID");
    const c = cal();

    // 1) Can the SA see this calendar?
    const meta = await c.calendars.get({ calendarId: CALENDAR_ID });

    // 2) Can it read events?
    const list = await c.events.list({ calendarId: CALENDAR_ID, maxResults: 1, singleEvents: true });

    res.status(200).json({
      ok: true,
      calendarId: CALENDAR_ID,
      calendarSummary: meta.data.summary,
      sampleEventCount: list.data.items?.length ?? 0,
    });
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message || String(err);
    const code = err?.response?.status || 500;
    return res.status(code).json({ ok: false, error: msg });
  }
}