import { z } from 'zod';
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULE_KEYS,
  PERMISSION_SCOPES,
  isValidPermission,
} from '../permissions';

export const permissionEntry = z
  .object({
    module: z.enum(PERMISSION_MODULE_KEYS as [string, ...string[]]),
    action: z.enum(PERMISSION_ACTIONS),
    scope: z.enum(PERMISSION_SCOPES),
  })
  .refine((p) => isValidPermission(p.module, p.action), 'Acción no aplicable a este módulo.');

export const roleInput = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre del rol.').max(60),
  description: z.string().trim().max(300).nullish(),
  permissions: z.array(permissionEntry).max(500),
});
export type RoleInput = z.infer<typeof roleInput>;
export const roleUpdate = roleInput.partial();
export type RoleUpdate = z.infer<typeof roleUpdate>;
