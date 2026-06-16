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

  // JSTで現在日時を計算（Railway はUTCなので+9時間）
  const nowUtc = new Date();
  const now = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);

  const dayOfWeek = now.getUTCDay(); // JSTの曜日
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;

  const nextMondayJst = new Date(now);
  nextMondayJst.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMondayJst.setUTCHours(0, 0, 0, 0);

  // UTCに戻してAPIに渡す
  const nextMonday = new Date(nextMondayJst.getTime() - 9 * 60 * 60 * 1000);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(nextSunday.getHours() + 23);
  nextSunday.setMinutes(59, 59, 999);

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
