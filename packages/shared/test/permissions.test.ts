import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_MODULES,
  can,
  isValidPermission,
  scopeOf,
  type PermissionModule,
} from '../src';

describe('catálogo de permisos', () => {
  it('el Administrador tiene todas las acciones de todos los módulos con alcance total', () => {
    for (const [module, def] of Object.entries(PERMISSION_MODULES)) {
      for (const action of def.actions) {
        expect(scopeOf(ADMIN_PERMISSIONS, module as PermissionModule, action)).toBe('ALL');
      }
    }
  });

  it('las matrices por defecto solo usan acciones válidas', () => {
    for (const map of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const [module, actions] of Object.entries(map)) {
        for (const action of Object.keys(actions ?? {})) {
          expect(isValidPermission(module, action), `${module}.${action}`).toBe(true);
        }
      }
    }
  });

  it('respeta la matriz aprobada (D-08)', () => {
    const { SUPERVISOR, SALES } = DEFAULT_ROLE_PERMISSIONS;
    expect(scopeOf(SALES, 'leads', 'view')).toBe('OWN');
    expect(scopeOf(SALES, 'contacts', 'view')).toBe('ALL');
    expect(scopeOf(SALES, 'contacts', 'edit')).toBe('OWN');
    expect(can(SALES, 'leads', 'import')).toBe(false);
    expect(can(SALES, 'duplicates', 'merge')).toBe(false);
    expect(can(SALES, 'users', 'view')).toBe(false);
    expect(scopeOf(SUPERVISOR, 'deals', 'edit')).toBe('TEAM');
    expect(can(SUPERVISOR, 'duplicates', 'merge')).toBe(true);
    expect(can(SUPERVISOR, 'trash', 'purge')).toBe(false);
    expect(can(SUPERVISOR, 'exchange_rates', 'manage')).toBe(false);
    expect(can(SUPERVISOR, 'settings', 'manage')).toBe(false);
  });

  it('can() compara alcances por amplitud', () => {
    const map = { leads: { view: 'TEAM' as const } };
    expect(can(map, 'leads', 'view')).toBe(true);
    expect(can(map, 'leads', 'view', 'TEAM')).toBe(true);
    expect(can(map, 'leads', 'view', 'ALL')).toBe(false);
    expect(can(map, 'leads', 'edit')).toBe(false);
  });
});
