import { z } from 'zod';
import { email, password } from './common';

export const loginInput = z.object({
  email,
  password: z.string().min(1, 'Ingrese la contraseña.').max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

export const forgotPasswordInput = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInput>;

export const resetPasswordInput = z.object({
  token: z.string().min(20).max(200),
  password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const changePasswordInput = z
  .object({
    currentPassword: z.string().min(1, 'Ingrese su contraseña actual.'),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'La nueva contraseña debe ser distinta de la actual.',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export const updateProfileInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
