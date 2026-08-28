import { createTransport } from 'nodemailer';
import type { AuthEmailDelivery, PasswordResetEmail, VerificationEmail } from './auth.email';

type SmtpEmailOptions = {
  host: string;
  port: number;
  from: string;
  webOrigin: string;
};

export class SmtpAuthEmailDelivery implements AuthEmailDelivery {
  private readonly transport;

  constructor(private readonly options: SmtpEmailOptions) {
    this.transport = createTransport({ host: options.host, port: options.port, secure: false });
  }

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    const url = `${this.options.webOrigin}/verify-email?token=${encodeURIComponent(message.verificationSecret)}`;
    await this.transport.sendMail({
      from: this.options.from,
      to: message.email,
      subject: 'Gatherly e-posta adresini doğrula',
      text: `E-posta adresini doğrulamak için bu bağlantıyı aç: ${url}`,
      html: `<p>E-posta adresini doğrulamak için <a href="${url}">bu bağlantıyı aç</a>.</p>`,
    });
  }

  async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
    const url = `${this.options.webOrigin}/reset-password?token=${encodeURIComponent(message.resetSecret)}`;
    await this.transport.sendMail({
      from: this.options.from,
      to: message.email,
      subject: 'Gatherly şifre sıfırlama',
      text: `Yeni şifreni belirlemek için bu bağlantıyı aç: ${url}`,
      html: `<p>Yeni şifreni belirlemek için <a href="${url}">bu bağlantıyı aç</a>.</p>`,
    });
  }
}
