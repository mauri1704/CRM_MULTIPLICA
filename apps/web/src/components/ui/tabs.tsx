import * as RT from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export function Tabs({
  value,
  onValueChange,
  items,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <RT.Root value={value} onValueChange={onValueChange}>
      <RT.List
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Secciones"
      >
        {items.map((i) => (
          <RT.Trigger
            key={i.value}
            value={i.value}
            className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg"
          >
            {i.label}
          </RT.Trigger>
        ))}
      </RT.List>
      {children}
    </RT.Root>
  );
}

export const TabPanel = RT.Content;
