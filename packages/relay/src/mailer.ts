import { createTransport } from "nodemailer";
import type { RelayConfig } from "./config.js";

export interface Mailer {
  sendMagicLink(email: string, link: string): Promise<void>;
}

/**
 * SMTP mailer when SMTP_* env vars are configured; otherwise a console mailer
 * that logs the link instead. The console fallback isn't a toy default — for
 * a self-hosted, single-admin deployment, reading the link from the Relay's
 * own process logs is a legitimate way to sign in the first time, before SMTP
 * is wired up (issue 10 leaves hosting specifics open).
 */
export function createMailer(config: RelayConfig): Mailer {
  if (!config.smtp) {
    return {
      async sendMagicLink(email, link) {
        console.log(`[relay] No SMTP configured — magic link for ${email}: ${link}`);
      },
    };
  }

  const smtp = config.smtp;
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  return {
    async sendMagicLink(email, link) {
      await transport.sendMail({
        from: smtp.from,
        to: email,
        subject: "Sign in to your Relay",
        text: `Sign in: ${link}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, ignore this email.`,
      });
    },
  };
}
