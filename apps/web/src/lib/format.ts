const dateTime = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Lima',
});
const date = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeZone: 'America/Lima' });

export const formatDateTime = (v: string | Date | null | undefined) =>
  v ? dateTime.format(new Date(v)) : '—';
export const formatDate = (v: string | Date | null | undefined) =>
  v ? date.format(new Date(v)) : '—';

export function relativeTime(v: string | Date): string {
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86_400) return `hace ${Math.floor(diff / 3600)} h`;
  return formatDate(v);
}
