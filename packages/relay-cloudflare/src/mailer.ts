export interface Mailer {
  sendMagicLink(email: string, link: string): Promise<void>;
}

/**
 * Console-only for now — mirrors the local Relay's no-SMTP default (issue 06):
 * for a self-hosted, single-admin deployment, reading the link via
 * `wrangler tail` is a legitimate way to sign in the first time. Swap in
 * Cloudflare Email Sending (or another provider) here if real email delivery
 * is needed later — not required for this ticket's scope (issue 14).
 */
export function createMailer(): Mailer {
  return {
    async sendMagicLink(email, link) {
      console.log(`[relay] No email provider configured — magic link for ${email}: ${link}`);
    },
  };
}
