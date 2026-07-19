import { Bot } from 'grammy';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { systemClock, type DomainContext } from '../domain/types.js';
import { createTelegramNotifier } from './notifier.js';
import { registerHandlers } from './handlers.js';
import { startWorkers } from './workers.js';
import { startWebhookServer, type WebhookServerHandle } from './server.js';

async function main() {
  const config = loadConfig();
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set — copy .env.example to .env and fill it in.');
  }
  if (config.botMode === 'webhook' && (!config.publicUrl || !config.webhookSecretToken)) {
    throw new Error(
      'BOT_MODE=webhook requires PUBLIC_URL and WEBHOOK_SECRET_TOKEN to be set. ' +
        'Use BOT_MODE=polling for local development instead.',
    );
  }

  const db = createDb(config.databasePath);
  const bot = new Bot(config.telegramBotToken);

  const domain: DomainContext = {
    db,
    clock: systemClock,
    notify: createTelegramNotifier(bot, db),
  };

  registerHandlers(bot, domain);

  const workers = startWorkers(domain, {
    reminderLeadHours: config.reminderLeadHours,
    reminderPollIntervalMinutes: config.reminderPollIntervalMinutes,
    invitationPollIntervalMinutes: config.invitationPollIntervalMinutes,
  });

  let webhookServer: WebhookServerHandle | undefined;

  const shutdown = async () => {
    workers.stop();
    if (webhookServer) {
      await webhookServer.close();
    } else {
      bot.stop();
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  if (config.botMode === 'polling') {
    console.log('Teleplay bot starting (long polling)...');
    await bot.start();
    return;
  }

  console.log('Teleplay bot starting (webhook)...');
  await bot.api.setWebhook(config.publicUrl + config.webhookPath, {
    secret_token: config.webhookSecretToken,
  });
  webhookServer = await startWebhookServer(bot, {
    port: config.port,
    webhookPath: config.webhookPath,
    webhookSecretToken: config.webhookSecretToken,
  });
  console.log(
    `Teleplay bot listening on port ${config.port}, webhook registered at ${config.publicUrl}${config.webhookPath}`,
  );
}

main().catch((err) => {
  console.error('Fatal error starting Teleplay:', err);
  process.exit(1);
});
