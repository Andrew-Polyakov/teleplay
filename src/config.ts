import 'dotenv/config';

export type BotMode = 'webhook' | 'polling';

export interface AppConfig {
  telegramBotToken: string;
  databasePath: string;
  reminderLeadHours: number;
  reminderPollIntervalMinutes: number;
  invitationTimeoutMinutes: number;
  invitationPollIntervalMinutes: number;
  botMode: BotMode;
  port: number;
  publicUrl: string;
  webhookPath: string;
  webhookSecretToken: string;
  wizardTimeStart: string;
  wizardTimeEnd: string;
  wizardTimeStepMinutes: number;
  wizardTimeoutMinutes: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBotMode(value: string | undefined, fallback: BotMode): BotMode {
  return value === 'webhook' || value === 'polling' ? value : fallback;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Loads config from environment. `TELEGRAM_BOT_TOKEN` is only required to actually
 * run the live bot (src/bot/index.ts) — domain logic, migrations, and tests don't need it.
 *
 * `BOT_MODE=webhook` (the default) requires `PUBLIC_URL` and `WEBHOOK_SECRET_TOKEN` to be set;
 * `BOT_MODE=polling` is a local-development escape hatch (webhooks need a publicly reachable
 * HTTPS URL, which usually means a tunnel like ngrok when developing locally).
 */
export function loadConfig(): AppConfig {
  return {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    databasePath: process.env.DATABASE_PATH ?? './teleplay.sqlite',
    reminderLeadHours: parseNumber(process.env.REMINDER_LEAD_HOURS, 3),
    reminderPollIntervalMinutes: parseNumber(process.env.REMINDER_POLL_INTERVAL_MINUTES, 1),
    invitationTimeoutMinutes: parseNumber(process.env.INVITATION_TIMEOUT_MINUTES, 60),
    invitationPollIntervalMinutes: parseNumber(process.env.INVITATION_POLL_INTERVAL_MINUTES, 1),
    botMode: parseBotMode(process.env.BOT_MODE, 'webhook'),
    port: parseNumber(process.env.PORT, 8080),
    publicUrl: stripTrailingSlash(process.env.PUBLIC_URL ?? ''),
    webhookPath: process.env.WEBHOOK_PATH ?? '/telegram/webhook',
    webhookSecretToken: process.env.WEBHOOK_SECRET_TOKEN ?? '',
    wizardTimeStart: process.env.WIZARD_TIME_START ?? '07:00',
    wizardTimeEnd: process.env.WIZARD_TIME_END ?? '22:00',
    wizardTimeStepMinutes: parseNumber(process.env.WIZARD_TIME_STEP_MINUTES, 60),
    wizardTimeoutMinutes: parseNumber(process.env.WIZARD_TIMEOUT_MINUTES, 10),
  };
}
