import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

// grammY's webhookCallback internally calls bot.init() (a real Telegram getMe() network
// call) before it even looks at the secret token. Our server.ts routing logic (path/method
// matching, 404, /healthz, delegating to the webhook handler) is what we own and want to
// test — the secret-token comparison itself is grammY's, already covered by their own tests.
// So we mock webhookCallback with a stand-in that mirrors its documented secret-token
// contract, and drive it through a real HTTP server to test our wiring end-to-end.
vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>();
  return {
    ...actual,
    webhookCallback:
      (_bot: unknown, _adapter: string, options?: { secretToken?: string }) =>
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const header = req.headers['x-telegram-bot-api-secret-token'];
        if (options?.secretToken !== undefined && header !== options.secretToken) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('unauthorized');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      },
  };
});

const { Bot } = await import('grammy');
const { startWebhookServer } = await import('../src/bot/server.js');

const SECRET = 'test-secret-token';
const WEBHOOK_PATH = '/telegram/webhook';

describe('webhook server', () => {
  let handle: Awaited<ReturnType<typeof startWebhookServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    const bot = new Bot('123:fake-token-for-tests');
    handle = await startWebhookServer(bot, { port: 0, webhookPath: WEBHOOK_PATH, webhookSecretToken: SECRET });
    const address = handle.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await handle.close();
  });

  function request(path: string, options: http.RequestOptions = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(baseUrl + path, options, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('responds 200 on GET /healthz', async () => {
    const res = await request('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('returns 404 for an unknown path', async () => {
    const res = await request('/nope');
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET on the webhook path', async () => {
    const res = await request(WEBHOOK_PATH, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('reaches the webhook handler when the secret token matches', async () => {
    const res = await request(WEBHOOK_PATH, {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    });
    expect(res.status).toBe(200);
  });

  it('rejects with 401 when the secret token header is missing', async () => {
    const res = await request(WEBHOOK_PATH, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects with 401 when the secret token is wrong', async () => {
    const res = await request(WEBHOOK_PATH, {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-token' },
    });
    expect(res.status).toBe(401);
  });
});
