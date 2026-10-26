import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Correo saliente. Sin SMTP_URL:
 * - en desarrollo el mensaje se escribe en el log (para poder probar la recuperación de clave);
 * - en pruebas se guarda en `outbox`;
 * - en producción no se envía y se registra un error (sin el contenido).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  readonly outbox: MailMessage[] = [];

  constructor() {
    const url = env().SMTP_URL;
    this.transport = url ? nodemailer.createTransport(url) : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.transport) {
      await this.transport.sendMail({ from: env().MAIL_FROM, ...message });
      return;
    }
    switch (env().NODE_ENV) {
      case 'test':
        this.outbox.push(message);
        return;
      case 'development':
        this.logger.warn(
          `[SMTP no configurado] Para ${message.to} — ${message.subject}\n${message.text}`,
        );
        return;
      default:
        this.logger.error(`SMTP no configurado: no se pudo enviar "${message.subject}".`);
    }
  }
}
