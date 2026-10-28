/**
 * `<input type="datetime-local">` ⇄ ISO 8601 en hora de Lima (D-21: zona única America/Lima,
 * UTC−5 sin horario de verano), igual que `formatDateTime`.
 */
const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}-05:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
