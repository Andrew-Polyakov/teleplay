import { Bot } from 'grammy';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { systemClock, type DomainContext } from '../domain/types.js';
import { createTelegramNotifier } from './notifier.js';
import { registerHandlers } from './handlers.js';
import { startWorkers } from './workers.js';
import { WizardStore } from './wizard/state.js';
import type { WizardDeps } from './wizard/handlers.js';
import { PromptStore } from './menu/prompts.js';
import { createMenus } from './menu/menus.js';
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

  // Without this, any error escaping a handler (e.g. answering a stale callback query
  // after a restart) kills the whole process — and an unacknowledged update would then
  // be re-delivered on startup, crash-looping the bot.
  bot.catch((err) => {
    console.error(`Error handling update ${err.ctx.update.update_id}:`, err.error);
  });

  const domain: DomainContext = {
    db,
    clock: systemClock,
    notify: createTelegramNotifier(bot, db),
  };

  const prompts = new PromptStore();
  const wizard: WizardDeps = {
    store: new WizardStore(),
    config: {
      timeStart: config.wizardTimeStart,
      timeEnd: config.wizardTimeEnd,
      timeStepMinutes: config.wizardTimeStepMinutes,
      timeoutMinutes: config.wizardTimeoutMinutes,
    },
    prompts,
  };

  // The menu plugin must see callback queries before the generic handler.
  const rootMenu = createMenus(domain, { wizard, prompts });
  bot.use(rootMenu);

  registerHandlers(bot, domain, wizard, { root: rootMenu, prompts });

  const workers = startWorkers(
    domain,
    {
      reminderLeadHours: config.reminderLeadHours,
      reminderPollIntervalMinutes: config.reminderPollIntervalMinutes,
      invitationPollIntervalMinutes: config.invitationPollIntervalMinutes,
    },
    () => {
      wizard.store.sweep(domain.clock.now(), wizard.config.timeoutMinutes);
      prompts.sweep(domain.clock.now(), wizard.config.timeoutMinutes);
    },
  );

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
