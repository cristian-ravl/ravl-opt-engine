const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function toDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function formatDateTime(value: string | null | undefined, fallback = 'Never'): string {
  const date = toDate(value);
  return date
    ? date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : fallback;
}

export function formatRelativeTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return 'Never';
  }

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 1) {
    return 'just now';
  }

  if (absMinutes < 60) {
    return relativeTimeFormatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return relativeTimeFormatter.format(diffDays, 'day');
  }

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return relativeTimeFormatter.format(diffMonths, 'month');
  }

  const diffYears = Math.round(diffMonths / 12);
  return relativeTimeFormatter.format(diffYears, 'year');
}

export function formatDateTimeWithRelative(value: string | null | undefined, fallback = 'Never'): string {
  const absolute = formatDateTime(value, fallback);
  if (absolute === fallback) {
    return fallback;
  }

  return `${absolute} (${formatRelativeTime(value)})`;
}

export function formatCompactNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  });
}

export function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[\-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
