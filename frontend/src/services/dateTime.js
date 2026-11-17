export const APP_TIME_ZONE = 'Asia/Kolkata';

// SQLite stores UTC timestamps without a trailing Z. Mark those values as UTC
// before displaying them so every browser converts them from the same instant.
export function toUtcDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const text = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const indiaDateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatIndiaDateTime(value, fallback = 'Time unavailable') {
  const date = toUtcDate(value);
  return date ? `${indiaDateTime.format(date)} IST` : fallback;
}
