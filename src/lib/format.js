/** Small display helpers shared by the library page. */

export function formatDateTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'unknown date';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

export function formatDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function relativeTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'just now';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(value);
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  try {
    return new Intl.NumberFormat().format(number);
  } catch {
    return String(number);
  }
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return Number(count) === 1 ? singular : pluralForm;
}

export function fileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

export function monogram(hostname) {
  const cleaned = String(hostname || '').replace(/^www\./i, '');
  const match = cleaned.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : '>';
}
