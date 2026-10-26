import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ChangePasswordInput, ResetPasswordInput, UpdateProfileInput } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { AppError, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { env } from '../../infra/env';
import { MailService } from '../../infra/mail.service';
import { AuditService } from '../audit/audit.service';
import { burnPasswordCheck, hashPassword, newToken, sha256, verifyPassword } from './password';
import { SessionService } from './session.service';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const RESET_TOKEN_MS = 3_600_000;

const invalidCredentials = () =>
  new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.db.client.user.findUnique({ where: { email } });
    if (!user) {
      await burnPasswordCheck(password);
      throw invalidCredentials();
    }
    const now = Date.now();
    if (user.lockedUntil && user.lockedUntil.getTime() > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now) / 60_000);
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ACCOUNT_LOCKED',
        `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en ${minutes} min.`,
      );
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.db.client.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(now + LOCK_MINUTES * 60_000) }
          : { failedLoginCount: failed },
      });
      await this.audit.logFor(user.organizationId, lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', {
        userId: user.id,
        ip,
        details: { attempt: failed },
      });
      throw invalidCredentials();
    }

    if (!user.active) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'USER_INACTIVE',
        'Su usuario está desactivado. Comuníquese con el administrador.',
      );
    }

    await this.db.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const session = await this.sessions.create(user.id, ip, userAgent);
    await this.audit.logFor(user.organizationId, 'LOGIN', { userId: user.id, ip });
    return session;
  }

  async logout(user: AuthUser, token: string, ip?: string): Promise<void> {
    await this.sessions.revoke(token);
    await this.audit.log('LOGOUT', { userId: user.id, ip });
  }

  /** Misma respuesta exista o no el correo (no revela qué correos están registrados). */
  async forgotPassword(email: string, ip?: string): Promise<void> {
    const user = await this.db.client.user.findUnique({ where: { email } });
    if (!user || !user.active) return;
    const { token, hash } = newToken();
    await this.db.client.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_MS) },
    });
    await this.audit.logFor(user.organizationId, 'PASSWORD_RESET_REQUESTED', {
      userId: user.id,
      ip,
    });
    const link = `${env().WEB_URL}/restablecer-clave?token=${encodeURIComponent(token)}`;
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Restablecer su contraseña — CRM Multiplica',
        text:
          `Hola ${user.name}:\n\nPara definir una nueva contraseña abra este enlace (válido por 1 hora):\n${link}\n\n` +
          'Si usted no lo solicitó, ignore este correo; su contraseña no cambia.',
      });
    } catch (e) {
      this.logger.error(
        `No se pudo enviar el correo de recuperación: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async resetPassword(input: ResetPasswordInput, ip?: string): Promise<void> {
    const record = await this.db.client.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
      include: { user: true },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      !record.user.active
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_TOKEN',
        'El enlace no es válido o ya expiró. Solicite uno nuevo.',
      );
    }
    const passwordHash = await hashPassword(input.password);
    await this.db.client.$transaction([
      this.db.client.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.db.client.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.db.client.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.logFor(record.user.organizationId, 'PASSWORD_RESET', {
      userId: record.userId,
      ip,
    });
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput, ip?: string): Promise<void> {
    const current = await this.db.q.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(current.passwordHash, input.currentPassword))) {
      throw validationError({ currentPassword: 'La contraseña actual no es correcta.' });
    }
    await this.db.q.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() },
    });
    await this.sessions.revokeAll(user.id, user.sessionId);
    await this.audit.log('PASSWORD_CHANGED', {
      userId: user.id,
      entityType: 'USER',
      entityId: user.id,
      ip,
    });
  }

  async updateProfile(user: AuthUser, input: UpdateProfileInput): Promise<void> {
    await this.db.q.user.update({ where: { id: user.id }, data: input });
  }

  async me(user: AuthUser) {
    const org = await this.db.q.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { id: true, name: true, baseCurrencyCode: true },
    });
    const { sessionId: _s, ...rest } = user;
    return { ...rest, organization: org };
  }
}
