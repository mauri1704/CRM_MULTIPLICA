import {
  can as canDo,
  type PermissionAction,
  type PermissionModule,
  type PermissionScope,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { ApiError, api, setUnauthorizedHandler } from './api';
import { applyTheme } from './theme';
import type { Me } from './types';

interface AuthContextValue {
  user: Me | null;
  loading: boolean;
  can: (module: PermissionModule, action: PermissionAction, atLeast?: PermissionScope) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(ME_KEY, null));
  }, [qc]);

  useEffect(() => {
    if (me.data) applyTheme(me.data.theme);
  }, [me.data]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ME_KEY });
  }, [qc]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    }
  }, [qc]);

  const user = me.data ?? null;
  const can = useCallback<AuthContextValue['can']>(
    (module, action, atLeast) => (user ? canDo(user.permissions, module, action, atLeast) : false),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading: me.isLoading, can, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

/** Usuario autenticado (solo dentro de las rutas protegidas). */
export function useUser(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('Sin usuario autenticado');
  return user;
}
