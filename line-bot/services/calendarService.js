/**
 * services/calendarService.js
 * Google Calendar APIで指定週の予定を取得する
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
 * 指定日を含む週（月〜日）の予定を取得する
 * @param {Date} targetJst - JST基準の対象日（getUTCDay/getUTCDateをJSTの曜日・日付として読む形。brain.jsのresolveScheduleWeekTarget参照）
 * @returns {{ events: object[], weekStart: Date, weekEnd: Date }}
 */
export async function getWeekEvents(targetJst) {
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const dayOfWeek = targetJst.getUTCDay(); // JSTの曜日（0=日,1=月,...）
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const mondayJst = new Date(targetJst);
  mondayJst.setUTCDate(targetJst.getUTCDate() + diffToMonday);
  mondayJst.setUTCHours(0, 0, 0, 0);

  // UTCに戻してAPIに渡す
  const monday = new Date(mondayJst.getTime() - 9 * 60 * 60 * 1000);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(sunday.getHours() + 23);
  sunday.setMinutes(59, 59, 999);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: monday.toISOString(),
    timeMax: sunday.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return {
    events: res.data.items ?? [],
    weekStart: monday,
    weekEnd: sunday,
  };
}
