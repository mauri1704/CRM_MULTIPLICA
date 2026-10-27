import { ChevronDown, ChevronUp, ChevronsUp, Equal, Flag, type LucideIcon } from 'lucide-react';

export const PRIORITY_ICON: Record<string, LucideIcon> = {
  'chevrons-up': ChevronsUp,
  'chevron-up': ChevronUp,
  equal: Equal,
  'chevron-down': ChevronDown,
  flag: Flag,
};

/** Distintivo de prioridad: ícono + texto + color (nunca solo color). */
export function PriorityBadge({
  name,
  color,
  icon,
}: {
  name: string;
  color: string;
  icon: string;
}) {
  const Icon = PRIORITY_ICON[icon] ?? Flag;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{ borderColor: color, color }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {name}
    </span>
  );
}
