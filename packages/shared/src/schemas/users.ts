import { z } from 'zod';
import { email, password, uuid } from './common';

export const createUserInput = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre.').max(120),
  email,
  roleId: uuid,
  password,
  teamIds: z.array(uuid).max(50).default([]),
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: email.optional(),
  roleId: uuid.optional(),
  teamIds: z.array(uuid).max(50).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInput>;

export const setUserPasswordInput = z.object({ password });
export type SetUserPasswordInput = z.infer<typeof setUserPasswordInput>;

export const teamInput = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre del equipo.').max(100),
  description: z.string().trim().max(500).nullish(),
  supervisorId: uuid.nullish(),
  memberIds: z.array(uuid).max(500).default([]),
});
export type TeamInput = z.infer<typeof teamInput>;
export const teamUpdate = teamInput.partial().extend({ active: z.boolean().optional() });
export type TeamUpdate = z.infer<typeof teamUpdate>;
