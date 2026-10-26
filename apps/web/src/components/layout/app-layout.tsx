import * as DM from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, KeyRound, LogOut, Menu, Monitor, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ChangePasswordDialog } from '@/features/auth/change-password-dialog';
import { api } from '@/lib/api';
import { ME_KEY, useAuth, useUser } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { applyTheme, type Theme } from '@/lib/theme';
import type { NotificationItem } from '@/lib/types';
import { NAV } from './nav';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface shadow-xl">
            <button
              type="button"
              className="absolute right-2 top-3 rounded p-1 text-fg-muted hover:bg-muted"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main id="contenido" className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const { can } = useAuth();
  const user = useUser();
  return (
    <nav aria-label="Menú principal" className="flex h-full flex-col">
      <Link to="/" className="flex h-14 items-center gap-2 border-b border-border px-4">
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <span className="font-semibold">CRM Multiplica</span>
      </Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV.map((section, i) => {
          const items = section.items.filter((it) => !it.permission || can(...it.permission));
          if (items.length === 0) return null;
          return (
            <div key={section.title ?? i}>
              {section.title && (
                <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {section.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm',
                          isActive
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-fg hover:bg-muted',
                        )
                      }
                    >
                      <it.icon className="h-4 w-4" aria-hidden />
                      {it.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-fg-muted">
        {user.organization.name}
      </p>
    </nav>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        className="rounded-md p-1.5 text-fg-muted hover:bg-muted lg:hidden"
        onClick={onMenu}
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="flex-1" />
      <Notifications />
      <ProfileMenu />
    </header>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="relative rounded-md p-2 text-fg-muted hover:bg-muted"
        aria-label={unread > 0 ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 min-w-[1.1rem] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-danger-fg">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notificaciones</p>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => readAll.mutate()}
              >
                Marcar todas como leídas
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(data?.items ?? []).length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-fg-muted">
                No hay notificaciones.
              </li>
            )}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    'block w-full px-3 py-2 text-left text-sm hover:bg-muted',
                    !n.readAt && 'bg-primary/5',
                  )}
                  onClick={async () => {
                    await api.post(`/notifications/${n.id}/read`);
                    await qc.invalidateQueries({ queryKey: ['notifications'] });
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className={cn(!n.readAt && 'font-medium')}>{n.title}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    {relativeTime(n.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Según el sistema', icon: Monitor },
];

function ProfileMenu() {
  const user = useUser();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const [pwdOpen, setPwdOpen] = useState(false);
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const setTheme = async (theme: Theme) => {
    applyTheme(theme);
    await api.patch('/auth/profile', { theme });
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };

  return (
    <>
      <DM.Root>
        <DM.Trigger
          className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-muted"
          aria-label="Menú de perfil"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg">
            {initials}
          </span>
          <span className="hidden text-left text-sm sm:block">
            <span className="block font-medium leading-tight">{user.name}</span>
            <span className="block text-xs leading-tight text-fg-muted">{user.roleName}</span>
          </span>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[220px] rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            <DM.Label className="px-2 py-1.5 text-xs text-fg-muted">{user.email}</DM.Label>
            <DM.Separator className="my-1 h-px bg-border" />
            <DM.Label className="px-2 pt-1 text-xs font-semibold text-fg-muted">Tema</DM.Label>
            <DM.RadioGroup value={user.theme} onValueChange={(v) => void setTheme(v as Theme)}>
              {THEMES.map((t) => (
                <DM.RadioItem
                  key={t.value}
                  value={t.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[state=checked]:font-medium data-[state=checked]:text-primary"
                >
                  <t.icon className="h-4 w-4" aria-hidden />
                  {t.label}
                </DM.RadioItem>
              ))}
            </DM.RadioGroup>
            <DM.Separator className="my-1 h-px bg-border" />
            <DM.Item
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted"
              onSelect={() => setPwdOpen(true)}
            >
              <KeyRound className="h-4 w-4" aria-hidden />
              Cambiar contraseña
            </DM.Item>
            <DM.Item
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-muted"
              onSelect={() => void logout()}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Cerrar sesión
            </DM.Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}
