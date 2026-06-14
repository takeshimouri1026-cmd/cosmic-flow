const KEY = "cosmic_flow_logs";

export function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveLog(entry) {
  const logs = loadLogs();
  const existing = logs.findIndex((l) => l.date === entry.date);
  if (existing >= 0) {
    logs[existing] = entry;
  } else {
    logs.unshift(entry);
  }
  localStorage.setItem(KEY, JSON.stringify(logs));
  return logs;
}

export function deleteLog(date) {
  const logs = loadLogs().filter((l) => l.date !== date);
  localStorage.setItem(KEY, JSON.stringify(logs));
  return logs;
}
