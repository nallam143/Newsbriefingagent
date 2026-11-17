const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function resolveTimeZone(value) {
  try {
    Intl.DateTimeFormat('en-IN', { timeZone: value || DEFAULT_TIMEZONE });
    return value || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const APP_TIMEZONE = resolveTimeZone(process.env.APP_TIMEZONE);

function appDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function appDateTime(value = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: APP_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(value);
}

module.exports = { APP_TIMEZONE, appDate, appDateTime };
