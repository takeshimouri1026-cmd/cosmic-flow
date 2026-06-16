/**
 * services/calendarService.js
 * Google Calendar APIで来週の予定を取得する
 */

import { google } from 'googleapis';

function getAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  return oauth2Client;
}

/**
 * 来週（月〜日）の予定を取得する
 * @returns {{ events: object[], weekStart: Date, weekEnd: Date }}
 */
export async function getNextWeekEvents() {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=日, 1=月, ...
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;

  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: nextMonday.toISOString(),
    timeMax: nextSunday.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return {
    events: res.data.items ?? [],
    weekStart: nextMonday,
    weekEnd: nextSunday,
  };
}
