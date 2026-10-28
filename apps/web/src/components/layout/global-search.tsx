import * as RD from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Contact,
  FolderKanban,
  Handshake,
  ListTodo,
  Loader2,
  Package,
  Search,
  Target,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { SearchResult } from '@/lib/types';

const GROUPS = [
  { key: 'leads', label: 'Prospectos', icon: Target, path: '/prospectos' },
  { key: 'deals', label: 'Negociaciones', icon: Handshake, path: '/negociaciones' },
  { key: 'contacts', label: 'Contactos', icon: Contact, path: '/contactos' },
  { key: 'companies', label: 'Compañías', icon: Building2, path: '/companias' },
  { key: 'products', label: 'Productos', icon: Package, path: '/productos' },
  { key: 'tasks', label: 'Tareas', icon: ListTodo, path: '/tareas' },
  { key: 'projects', label: 'Proyectos', icon: FolderKanban, path: '/proyectos' },
] as const;

/** Búsqueda global (Ctrl+K o /). Solo devuelve lo que el usuario puede ver. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResult>('/search', { q: debounced }),
    enabled: open && debounced.length >= 2,
  });
  const flat = useMemo(
    () =>
      GROUPS.flatMap((g) =>
        (data?.[g.key] ?? []).map((item) => ({
          ...item,
          path: `${g.path}?id=${item.id}`,
          group: g,
        })),
      ),
    [data],
  );
  const go = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm text-fg-muted hover:border-primary/40"
        aria-label="Buscar (Ctrl+K)"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">Buscar prospectos, negociaciones, tareas…</span>
        <kbd className="hidden rounded border border-border px-1.5 text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>
      <RD.Root open={open} onOpenChange={setOpen}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <RD.Content className="fixed left-1/2 top-[10vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-border bg-surface shadow-xl">
            <RD.Title className="sr-only">Búsqueda global</RD.Title>
            <RD.Description className="sr-only">
              Escriba al menos dos caracteres. Use las flechas y Enter para abrir un resultado.
            </RD.Description>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 text-fg-muted" aria-hidden />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, flat.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === 'Enter' && flat[active]) {
                    e.preventDefault();
                    go(flat[active].path);
                  }
                }}
                placeholder="Nombre, correo, RUC, documento, SKU o código…"
                aria-label="Buscar"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
              {isFetching && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden />}
            </div>
            <div
              className="max-h-[60vh] overflow-y-auto p-2"
              role="listbox"
              aria-label="Resultados"
            >
              {debounced.length < 2 && (
                <p className="px-2 py-6 text-center text-sm text-fg-muted">
                  Escriba al menos 2 caracteres.
                </p>
              )}
              {debounced.length >= 2 && !isFetching && flat.length === 0 && (
                <p className="px-2 py-6 text-center text-sm text-fg-muted">
                  Sin resultados para «{debounced}».
                </p>
              )}
              {GROUPS.map((g) => {
                const items = flat.filter((f) => f.group.key === g.key);
                if (items.length === 0) return null;
                return (
                  <div key={g.key} className="mb-2">
                    <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                      {g.label}
                    </p>
                    {items.map((item) => {
                      const index = flat.indexOf(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={index === active}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(item.path)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm',
                            index === active ? 'bg-primary/10' : 'hover:bg-muted',
                          )}
                        >
                          <g.icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{item.title}</span>
                            <span className="block truncate text-xs text-fg-muted">
                              {item.subtitle}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </RD.Content>
        </RD.Portal>
      </RD.Root>
    </>
  );
}
