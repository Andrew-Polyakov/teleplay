import { describe, it, expect, beforeEach } from 'vitest';
import { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { createTestContext } from './testContext.js';
import { registerHandlers } from '../src/bot/handlers.js';
import { WizardStore } from '../src/bot/wizard/state.js';
import type { WizardDeps } from '../src/bot/wizard/handlers.js';
import { PromptStore } from '../src/bot/menu/prompts.js';
import { createMenus } from '../src/bot/menu/menus.js';
import { availableMatchActions } from '../src/domain/actions.js';
import { registerUser, listRegisteredUsers } from '../src/domain/users.js';
import { createMatch, confirmMainParticipant } from '../src/domain/matches.js';
import { cancelMatch } from '../src/domain/lifecycle.js';
import { matches, matchParticipants } from '../src/db/schema.js';

const WIZARD_CONFIG = { timeStart: '07:00', timeEnd: '22:00', timeStepMinutes: 60, timeoutMinutes: 10 };

interface Button {
  text: string;
  callback_data?: string;
  url?: string;
}

function createMenuHarness(harness: ReturnType<typeof createTestContext>) {
  const bot = new Bot('test-token', {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'Teleplay',
      username: 'teleplaybot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    } as UserFromGetMe,
  });

  const apiCalls: { method: string; payload: Record<string, unknown> }[] = [];
  // Latest inline keyboard per chat:message, kept current across sends and edits.
  const keyboards = new Map<string, Button[][]>();
  let nextMessageId = 1000;

  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    const p = payload as {
      chat_id?: number;
      message_id?: number;
      text?: string;
      reply_markup?: { inline_keyboard?: Button[][] };
    };
    if (method === 'sendMessage') {
      const id = ++nextMessageId;
      if (p.reply_markup?.inline_keyboard) keyboards.set(`${p.chat_id}:${id}`, p.reply_markup.inline_keyboard);
      return {
        ok: true,
        result: { message_id: id, chat: { id: p.chat_id, type: 'private' }, date: 0, text: p.text },
      } as never;
    }
    if ((method === 'editMessageText' || method === 'editMessageReplyMarkup') && p.chat_id && p.message_id) {
      if (p.reply_markup?.inline_keyboard) keyboards.set(`${p.chat_id}:${p.message_id}`, p.reply_markup.inline_keyboard);
      else keyboards.delete(`${p.chat_id}:${p.message_id}`);
    }
    return { ok: true, result: true } as never;
  });

  const prompts = new PromptStore();
  const wizard: WizardDeps = { store: new WizardStore(), config: WIZARD_CONFIG, prompts };
  const rootMenu = createMenus(harness.ctx, { wizard, prompts });
  bot.use(rootMenu);
  registerHandlers(bot, harness.ctx, wizard, { root: rootMenu, prompts });

  let updateId = 0;
  const player = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });

  async function sendText(from: ReturnType<typeof player>, text: string) {
    const commandLength = text.startsWith('/') ? text.split(' ')[0]!.length : 0;
    await bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: ++updateId,
        date: 0,
        chat: { id: from.id, type: 'private' },
        from,
        text,
        entities: commandLength ? [{ type: 'bot_command', offset: 0, length: commandLength }] : undefined,
      },
    } as unknown as Update);
  }

  async function tap(from: ReturnType<typeof player>, messageId: number, data: string) {
    await bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: `cb-${updateId}`,
        from,
        chat_instance: 'ci',
        data,
        message: { message_id: messageId, date: 0, chat: { id: from.id, type: 'private' }, text: 'menu' },
      },
    } as unknown as Update);
  }

  function lastMessageId(chatId: number, textIncludes: string): number {
    const sends = apiCalls.filter(
      (c) => c.method === 'sendMessage' && c.payload.chat_id === chatId && String(c.payload.text).includes(textIncludes),
    );
    expect(sends.length).toBeGreaterThan(0);
    const index = apiCalls.indexOf(sends[sends.length - 1]!);
    // message ids are assigned sequentially per sendMessage, so recount sends up to here
    const sendCount = apiCalls.slice(0, index + 1).filter((c) => c.method === 'sendMessage').length;
    return 1000 + sendCount;
  }

  function keyboard(chatId: number, messageId: number): Button[][] {
    return keyboards.get(`${chatId}:${messageId}`) ?? [];
  }

  function findButton(chatId: number, messageId: number, textIncludes: string): Button | undefined {
    return keyboard(chatId, messageId)
      .flat()
      .find((b) => b.text.includes(textIncludes));
  }

  async function tapButton(from: ReturnType<typeof player>, messageId: number, textIncludes: string) {
    const button = findButton(from.id, messageId, textIncludes);
    expect(button?.callback_data, `button "${textIncludes}" on message ${messageId}`).toBeDefined();
    await tap(from, messageId, button!.callback_data!);
  }

  function sentTexts(): string[] {
    return apiCalls.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload.text));
  }

  function answers(): (string | undefined)[] {
    return apiCalls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.payload.text as string | undefined);
  }

  return { bot, wizard, prompts, apiCalls, player, sendText, tap, tapButton, findButton, keyboard, lastMessageId, sentTexts, answers };
}

describe('availableMatchActions', () => {
  it('derives visibility from match state and the player role', () => {
    const { ctx } = createTestContext();
    const creator = registerUser(ctx, { telegramUserId: '@a', chatId: '1', displayName: 'A' });
    registerUser(ctx, { telegramUserId: '@b', chatId: '2', displayName: 'B' });
    const outsider = registerUser(ctx, { telegramUserId: '@c', chatId: '3', displayName: 'C' });

    const singles = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00Z'),
      creatorTelegramUserId: '@a',
      otherMainParticipants: [{ kind: 'direct', telegramUserId: '@b' }],
    });

    expect(availableMatchActions(ctx, singles.id, creator.id)).toEqual({
      venue: true,
      reschedule: true,
      retire: false,
      cancel: true,
    });
    expect(availableMatchActions(ctx, singles.id, outsider.id)).toEqual({
      venue: false,
      reschedule: false,
      retire: false,
      cancel: false,
    });

    cancelMatch(ctx, singles.id, creator.id);
    expect(availableMatchActions(ctx, singles.id, creator.id).cancel).toBe(false);
    expect(availableMatchActions(ctx, singles.id, creator.id).venue).toBe(false);
  });

  it('offers retire only on a confirmed doubles match for a confirmed main player', () => {
    const { ctx } = createTestContext();
    registerUser(ctx, { telegramUserId: '@a', chatId: '1', displayName: 'A' });
    const players = ['@p2', '@p3', '@p4'].map((tid, i) =>
      registerUser(ctx, { telegramUserId: tid, chatId: String(i + 2), displayName: tid }),
    );
    const doubles = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-02-01T10:00:00Z'),
      creatorTelegramUserId: '@a',
      otherMainParticipants: players.map((p) => ({ kind: 'direct' as const, telegramUserId: p.telegramUserId })),
    });

    expect(availableMatchActions(ctx, doubles.id, players[0]!.id).retire).toBe(false); // pending match
    for (const p of players) confirmMainParticipant(ctx, doubles.id, p.id);
    expect(availableMatchActions(ctx, doubles.id, players[0]!.id).retire).toBe(true);
  });
});

describe('prompt store', () => {
  it('expires prompts and sweeps idle ones', () => {
    const store = new PromptStore();
    store.start({ telegramUserId: '@a', matchId: 1, now: new Date('2026-01-01T00:00:00Z') });
    expect(store.get('@a', new Date('2026-01-01T00:05:00Z'), 10)?.matchId).toBe(1);
    expect(store.get('@a', new Date('2026-01-01T00:11:00Z'), 10)).toBeUndefined();
    store.start({ telegramUserId: '@b', matchId: 2, now: new Date('2026-01-01T00:00:00Z') });
    expect(store.sweep(new Date('2026-01-01T00:20:00Z'), 10)).toBe(1);
  });
});

describe('menu system end-to-end (stubbed bot)', () => {
  let harness: ReturnType<typeof createTestContext>;
  let bot: ReturnType<typeof createMenuHarness>;
  let alice: ReturnType<ReturnType<typeof createMenuHarness>['player']>;
  let bob: ReturnType<ReturnType<typeof createMenuHarness>['player']>;

  beforeEach(async () => {
    harness = createTestContext(new Date('2026-01-01T00:00:00.000Z'));
    bot = createMenuHarness(harness);
    alice = bot.player(11, 'alice');
    bob = bot.player(12, 'bob');
    await bot.sendText(alice, '/start');
    await bot.sendText(bob, '/start');
  });

  async function openMenu(from = alice): Promise<number> {
    await bot.sendText(from, '/menu');
    return bot.lastMessageId(from.id, 'Teleplay menu');
  }

  it('renders the root menu, lists live matches, and drops cancelled ones on outdated taps', async () => {
    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    const menuId = await openMenu();
    expect(bot.findButton(alice.id, menuId, 'My matches')).toBeDefined();
    expect(bot.findButton(alice.id, menuId, 'Pending invites')).toBeDefined();

    await bot.tapButton(alice, menuId, 'My matches');
    // "⏳ Venue TBD, at 18:00 1 Feb with @bob" — venue, time, and opponent, no ids
    expect(bot.findButton(alice.id, menuId, 'Venue TBD, at 18:00 1 Feb with @bob')).toBeDefined();

    await bot.sendText(alice, '/cancel 1');
    await bot.tapButton(alice, menuId, 'with @bob'); // stale button
    expect(bot.answers().some((t) => t?.includes('Menu updated'))).toBe(true);
    expect(bot.findButton(alice.id, menuId, 'No upcoming matches')).toBeDefined();
  });

  it('shows context-sensitive actions in the per-match submenu', async () => {
    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    const menuId = await openMenu();
    await bot.tapButton(alice, menuId, 'My matches');
    await bot.tapButton(alice, menuId, 'with @bob');

    expect(bot.findButton(alice.id, menuId, 'Set venue')).toBeDefined();
    expect(bot.findButton(alice.id, menuId, 'Reschedule')).toBeDefined();
    expect(bot.findButton(alice.id, menuId, 'Cancel match')).toBeDefined();
    expect(bot.findButton(alice.id, menuId, 'Retire')).toBeUndefined();
    // Direct chat link to the opponent — a URL button, not a callback
    const textButton = bot.findButton(alice.id, menuId, 'Text @bob');
    expect(textButton?.url).toBe('https://t.me/bob');
    expect(textButton?.callback_data).toBeUndefined();
  });

  it('sets a venue via the menu prompt', async () => {
    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    const menuId = await openMenu();
    await bot.tapButton(alice, menuId, 'My matches');
    await bot.tapButton(alice, menuId, 'with @bob');
    await bot.tapButton(alice, menuId, 'Set venue');
    expect(bot.sentTexts().some((t) => t.includes('Send the venue for match #1'))).toBe(true);

    await bot.sendText(alice, 'Court 5, Riverside Club');
    const row = harness.ctx.db.select().from(matches).all()[0]!;
    expect(row.venue).toBe('Court 5, Riverside Club');
    expect(bot.sentTexts().some((t) => t.includes('Venue for match #1 set to: Court 5, Riverside Club'))).toBe(true);
  });

  it('proposes a reschedule via the menu using the wizard pickers', async () => {
    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    const bobId = listRegisteredUsers(harness.ctx).find((u) => u.telegramUserId === '@bob')!.id;
    confirmMainParticipant(harness.ctx, 1, bobId);

    const menuId = await openMenu();
    await bot.tapButton(alice, menuId, 'My matches');
    await bot.tapButton(alice, menuId, 'with @bob');
    await bot.tapButton(alice, menuId, 'Reschedule');

    const wizId = bot.lastMessageId(alice.id, 'Reschedule match #1');
    await bot.tap(alice, wizId, 'wiz:date:2026-02-05');
    await bot.tap(alice, wizId, 'wiz:time:0900');
    await bot.tap(alice, wizId, 'wiz:create:-');

    const row = harness.ctx.db.select().from(matches).all()[0]!;
    expect(row.overallStatus).toBe('pending');
    expect(row.pendingScheduledAt).toBe(new Date('2026-02-05T09:00:00.000Z').getTime());
    const bobRow = harness.ctx.db
      .select()
      .from(matchParticipants)
      .all()
      .find((p) => p.userId === bobId)!;
    expect(bobRow.participantStatus).toBe('invited');
  });

  it('accepts a pending invitation from the menu', async () => {
    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    const menuId = await openMenu(bob);
    await bot.tapButton(bob, menuId, 'Pending invites');
    expect(bot.findButton(bob.id, menuId, '#1 singles')).toBeDefined();

    await bot.tapButton(bob, menuId, 'Accept');
    const bobId = listRegisteredUsers(harness.ctx).find((u) => u.telegramUserId === '@bob')!.id;
    const bobRow = harness.ctx.db
      .select()
      .from(matchParticipants)
      .all()
      .find((p) => p.userId === bobId)!;
    expect(bobRow.participantStatus).toBe('confirmed');
    // list re-renders without the accepted invite
    expect(bot.findButton(bob.id, menuId, 'Accept')).toBeUndefined();
  });

  it('cancels a match only after the confirmation step', async () => {
    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    const menuId = await openMenu();
    await bot.tapButton(alice, menuId, 'My matches');
    await bot.tapButton(alice, menuId, 'with @bob');
    await bot.tapButton(alice, menuId, 'Cancel match');

    expect(harness.ctx.db.select().from(matches).all()[0]!.overallStatus).toBe('pending');
    await bot.tapButton(alice, menuId, 'Yes — cancel match #1');
    expect(harness.ctx.db.select().from(matches).all()[0]!.overallStatus).toBe('cancelled');
  });
});
