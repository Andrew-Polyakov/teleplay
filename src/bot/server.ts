import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type Bot, webhookCallback } from 'grammy';

export interface WebhookServerConfig {
  port: number;
  webhookPath: string;
  webhookSecretToken: string;
}

export interface WebhookServerHandle {
  server: Server;
  close(): Promise<void>;
}

/**
 * Builds the raw Node `http` request listener for the bot's webhook server:
 * POST {webhookPath} -> grammY's webhook handler (which itself validates the
 * X-Telegram-Bot-Api-Secret-Token header against webhookSecretToken), GET /healthz -> 200,
 * anything else -> 404. Exported separately from `startWebhookServer` so tests can drive it
 * without binding a real port.
 */
export function createRequestListener(bot: Bot, config: Pick<WebhookServerConfig, 'webhookPath' | 'webhookSecretToken'>) {
  const handleUpdate = webhookCallback(bot, 'http', { secretToken: config.webhookSecretToken });

  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0];

    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.method === 'POST' && path === config.webhookPath) {
      try {
        await handleUpdate(req, res);
      } catch (err) {
        console.error('Webhook handler error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('internal error');
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };
}

/** Starts the webhook HTTP server, resolving once it's listening on `config.port`. */
export function startWebhookServer(bot: Bot, config: WebhookServerConfig): Promise<WebhookServerHandle> {
  const server = createServer(createRequestListener(bot, config));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.removeListener('error', reject);
      resolve({
        server,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
