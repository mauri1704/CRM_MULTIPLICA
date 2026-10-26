import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordInput,
  forgotPasswordInput,
  loginInput,
  resetPasswordInput,
  updateProfileInput,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
} from '@crm/shared';
import type { CookieOptions, Response } from 'express';
import { SESSION_COOKIE } from '../../common/auth.guard';
import type { AuthRequest, AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, Public } from '../../common/decorators';
import { ZodBody } from '../../common/zod';
import { env } from '../../infra/env';
import { AuthService } from './auth.service';

const STRICT = { default: { limit: () => env().AUTH_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } };

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  @ZodBody(loginInput)
  async login(
    @Body() body: LoginInput,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, expiresAt } = await this.auth.login(
      body.email,
      body.password,
      req.ip,
      req.header('user-agent'),
    );
    res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user, String(req.cookies?.[SESSION_COOKIE] ?? ''), req.ip);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Public()
  @Throttle(STRICT)
  @Post('forgot-password')
  @HttpCode(200)
  @ZodBody(forgotPasswordInput)
  async forgot(@Body() body: ForgotPasswordInput, @ClientIp() ip: string | undefined) {
    await this.auth.forgotPassword(body.email, ip);
    return {
      ok: true,
      message: 'Si el correo está registrado, recibirá un enlace para restablecer su contraseña.',
    };
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(200)
  @ZodBody(resetPasswordInput)
  async reset(@Body() body: ResetPasswordInput, @ClientIp() ip: string | undefined) {
    await this.auth.resetPassword(body, ip);
    return { ok: true };
  }

  @Throttle(STRICT)
  @Post('change-password')
  @HttpCode(200)
  @ZodBody(changePasswordInput)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: ChangePasswordInput,
  ) {
    await this.auth.changePassword(user, body, ip);
    return { ok: true };
  }

  @Patch('profile')
  @ZodBody(updateProfileInput)
  async profile(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileInput) {
    await this.auth.updateProfile(user, body);
    return { ok: true };
  }
}
