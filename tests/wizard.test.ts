import { describe, it, expect, beforeEach } from 'vitest';
import { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { createTestContext } from './testContext.js';
import { registerHandlers } from '../src/bot/handlers.js';
import { WizardStore, monthKey, requiredOtherMainCount } from '../src/bot/wizard/state.js';
import type { WizardDeps } from '../src/bot/wizard/handlers.js';
import { calendarKeyboard, timeSlotKeyboard, NOOP } from '../src/bot/wizard/keyboards.js';
import { listRegisteredUsers, registerUser } from '../src/domain/users.js';
import { matches, matchParticipants } from '../src/db/schema.js';

const WIZARD_CONFIG = { timeStart: '07:00', timeEnd: '22:00', timeStepMinutes: 30, timeoutMinutes: 10 };

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

/** A real grammY Bot with the outbound API stubbed, driven by hand-crafted updates. */
function createBotHarness(harness: ReturnType<typeof createTestContext>) {
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

  const apiCalls: ApiCall[] = [];
  let nextMessageId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') {
      const p = payload as { chat_id: number; text: string };
      return {
        ok: true,
        result: { message_id: ++nextMessageId, chat: { id: p.chat_id, type: 'private' }, date: 0, text: p.text },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  const wizard: WizardDeps = { store: new WizardStore(), config: WIZARD_CONFIG };
  registerHandlers(bot, harness.ctx, wizard);

  let updateId = 0;
  const player = (id: number, username: string) => ({ id, is_bot: false, first_name: username, username });

  async function sendText(from: ReturnType<typeof player>, text: string) {
    const commandLength = text.startsWith('/') ? text.split(' ')[0]!.length : 0;
    const update = {
      update_id: ++updateId,
      message: {
        message_id: ++updateId,
        date: 0,
        chat: { id: from.id, type: 'private' },
        from,
        text,
        entities: commandLength ? [{ type: 'bot_command', offset: 0, length: commandLength }] : undefined,
      },
    } as unknown as Update;
    await bot.handleUpdate(update);
  }

  async function tap(from: ReturnType<typeof player>, data: string) {
    const update = {
      update_id: ++updateId,
      callback_query: {
        id: `cb-${updateId}`,
        from,
        chat_instance: 'ci',
        data,
        message: { message_id: 999, date: 0, chat: { id: from.id, type: 'private' } },
      },
    } as unknown as Update;
    await bot.handleUpdate(update);
  }

  function sentTexts(): string[] {
    return apiCalls.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload.text));
  }

  function lastAnswerText(): string | undefined {
    const answers = apiCalls.filter((c) => c.method === 'answerCallbackQuery');
    return answers.length ? (answers[answers.length - 1]!.payload.text as string | undefined) : undefined;
  }

  return { bot, wizard, apiCalls, player, sendText, tap, sentTexts, lastAnswerText };
}

function allMatches(harness: ReturnType<typeof createTestContext>) {
  return harness.ctx.db.select().from(matches).all();
}

function participantsOf(harness: ReturnType<typeof createTestContext>, matchId: number) {
  return harness.ctx.db.select().from(matchParticipants).all().filter((p) => p.matchId === matchId);
}

describe('listRegisteredUsers', () => {
  it('returns everyone ordered by display name', () => {
    const { ctx } = createTestContext();
    registerUser(ctx, { telegramUserId: '@zoe', chatId: '1', displayName: 'Zoe' });
    registerUser(ctx, { telegramUserId: '@abe', chatId: '2', displayName: 'Abe' });
    expect(listRegisteredUsers(ctx).map((u) => u.telegramUserId)).toEqual(['@abe', '@zoe']);
  });
});

describe('wizard state store', () => {
  const store = () => new WizardStore();

  it('replaces an existing wizard on restart', () => {
    const s = store();
    const first = s.start({ telegramUserId: '@a', chatId: 1, now: new Date('2026-01-01T00:00:00Z') });
    first.step = 'summary';
    const second = s.start({ telegramUserId: '@a', chatId: 1, now: new Date('2026-01-01T00:01:00Z') });
    expect(second.step).toBe('type');
    expect(s.get('@a', new Date('2026-01-01T00:01:00Z'), 10)).toBe(second);
  });

  it('expires idle wizards on access and via sweep', () => {
    const s = store();
    s.start({ telegramUserId: '@a', chatId: 1, now: new Date('2026-01-01T00:00:00Z') });
    s.start({ telegramUserId: '@b', chatId: 2, now: new Date('2026-01-01T00:09:00Z') });
    expect(s.get('@a', new Date('2026-01-01T00:11:00Z'), 10)).toBeUndefined();
    expect(s.sweep(new Date('2026-01-01T00:11:00Z'), 10)).toBe(0); // @a already lazily purged
    expect(s.sweep(new Date('2026-01-01T00:30:00Z'), 10)).toBe(1); // @b swept
  });

  it('monthKey and requiredOtherMainCount behave', () => {
    expect(monthKey(new Date('2026-07-23T10:00:00Z'))).toBe('2026-07');
    expect(requiredOtherMainCount('singles')).toBe(1);
    expect(requiredOtherMainCount('doubles')).toBe(3);
  });
});

describe('wizard keyboards', () => {
  it('renders past days as inert and future days as selectable', () => {
    const kb = calendarKeyboard('2026-01', new Date('2026-01-15T12:00:00Z')).inline_keyboard;
    const cells = kb.flat().filter((b) => 'callback_data' in b) as { text: string; callback_data: string }[];
    const day14 = cells.find((c) => c.callback_data === 'wiz:date:2026-01-14');
    const day15 = cells.find((c) => c.callback_data === 'wiz:date:2026-01-15');
    const inertDots = cells.filter((c) => c.text === '·');
    expect(day14).toBeUndefined();
    expect(day15?.text).toBe('15');
    expect(inertDots).toHaveLength(14);
    expect(inertDots.every((c) => c.callback_data === NOOP)).toBe(true);
  });

  it('clamps navigation at the current month and renders month boundaries', () => {
    const today = new Date('2026-01-15T12:00:00Z');
    const jan = calendarKeyboard('2026-01', today).inline_keyboard;
    const [prev, , next] = jan[0] as { text: string; callback_data: string }[];
    expect(prev!.callback_data).toBe(NOOP);
    expect(next!.callback_data).toBe('wiz:cal:2026-02');

    const feb = calendarKeyboard('2026-02', today).inline_keyboard;
    const febCells = feb.flat() as { text: string; callback_data: string }[];
    expect(febCells.find((c) => c.callback_data === 'wiz:date:2026-02-01')).toBeDefined();
    expect(febCells.find((c) => c.callback_data === 'wiz:date:2026-02-28')).toBeDefined();
    expect(febCells.find((c) => c.callback_data === 'wiz:date:2026-02-29')).toBeUndefined();
    expect((feb[0] as { callback_data: string }[])[0]!.callback_data).toBe('wiz:cal:2026-01');
  });

  it('generates time slots from config bounds inclusive', () => {
    const kb = timeSlotKeyboard('07:00', '08:00', 30).inline_keyboard;
    const slots = kb.flat().filter((b) => (b as { callback_data: string }).callback_data.startsWith('wiz:time:'));
    expect(slots.map((s) => (s as { text: string }).text)).toEqual(['07:00', '07:30', '08:00']);
    expect((slots[1] as { callback_data: string }).callback_data).toBe('wiz:time:0730');
  });
});

describe('wizard end-to-end (stubbed bot)', () => {
  let harness: ReturnType<typeof createTestContext>;
  let bot: ReturnType<typeof createBotHarness>;

  beforeEach(() => {
    harness = createTestContext(new Date('2026-01-01T00:00:00.000Z'));
    bot = createBotHarness(harness);
  });

  it('wizard singles flow creates the same match as the one-line command', async () => {
    const alice = bot.player(11, 'alice');
    const bob = bot.player(12, 'bob');
    await bot.sendText(alice, '/start');
    await bot.sendText(bob, '/start');
    const bobDbId = listRegisteredUsers(harness.ctx).find((u) => u.telegramUserId === '@bob')!.id;

    await bot.sendText(alice, '/match');
    await bot.tap(alice, 'wiz:type:singles');
    await bot.tap(alice, 'wiz:date:2026-02-01');
    await bot.tap(alice, 'wiz:time:1830');
    await bot.tap(alice, `wiz:player:${bobDbId}`);
    await bot.tap(alice, 'wiz:done:-');
    await bot.tap(alice, 'wiz:create:-');

    // Equivalent power-syntax match for comparison (creator carol, invitee dave).
    const carol = bot.player(13, 'carol');
    const dave = bot.player(14, 'dave');
    await bot.sendText(carol, '/start');
    await bot.sendText(dave, '/start');
    await bot.sendText(carol, '/match singles 2026-02-01T18:30:00Z @dave');

    const created = allMatches(harness);
    expect(created).toHaveLength(2);
    const [wizardMatch, commandMatch] = created;
    expect(wizardMatch!.type).toBe('singles');
    expect(wizardMatch!.scheduledAt).toBe(commandMatch!.scheduledAt);
    expect(wizardMatch!.overallStatus).toBe(commandMatch!.overallStatus);

    const wizardParts = participantsOf(harness, wizardMatch!.id);
    const commandParts = participantsOf(harness, commandMatch!.id);
    expect(wizardParts.map((p) => [p.slotType, p.participantStatus]).sort()).toEqual(
      commandParts.map((p) => [p.slotType, p.participantStatus]).sort(),
    );
  });

  it('doubles flow with bench selection attaches bench participants', async () => {
    const users = ['alice', 'p2', 'p3', 'p4', 'sub'].map((name, i) => bot.player(20 + i, name));
    for (const u of users) await bot.sendText(u, '/start');
    const byTid = new Map(listRegisteredUsers(harness.ctx).map((u) => [u.telegramUserId, u.id]));

    const alice = users[0]!;
    await bot.sendText(alice, '/match');
    await bot.tap(alice, 'wiz:type:doubles');
    await bot.tap(alice, 'wiz:date:2026-02-02');
    await bot.tap(alice, 'wiz:time:0900');
    for (const tid of ['@p2', '@p3', '@p4']) await bot.tap(alice, `wiz:player:${byTid.get(tid)}`);
    await bot.tap(alice, 'wiz:done:-');
    await bot.tap(alice, `wiz:player:${byTid.get('@sub')}`); // bench step
    await bot.tap(alice, 'wiz:done:-');
    await bot.tap(alice, 'wiz:create:-');

    const created = allMatches(harness);
    expect(created).toHaveLength(1);
    const parts = participantsOf(harness, created[0]!.id);
    expect(parts.filter((p) => p.slotType === 'main')).toHaveLength(4);
    expect(parts.filter((p) => p.slotType === 'bench')).toHaveLength(1);
  });

  it('doubles flow with Skip creates no bench participants', async () => {
    const users = ['alice', 'p2', 'p3', 'p4'].map((name, i) => bot.player(30 + i, name));
    for (const u of users) await bot.sendText(u, '/start');
    const byTid = new Map(listRegisteredUsers(harness.ctx).map((u) => [u.telegramUserId, u.id]));

    const alice = users[0]!;
    await bot.sendText(alice, '/match');
    await bot.tap(alice, 'wiz:type:doubles');
    await bot.tap(alice, 'wiz:date:2026-02-02');
    await bot.tap(alice, 'wiz:time:0900');
    for (const tid of ['@p2', '@p3', '@p4']) await bot.tap(alice, `wiz:player:${byTid.get(tid)}`);
    await bot.tap(alice, 'wiz:done:-');
    await bot.tap(alice, 'wiz:skip:-');
    await bot.tap(alice, 'wiz:create:-');

    const created = allMatches(harness);
    expect(created).toHaveLength(1);
    expect(participantsOf(harness, created[0]!.id).filter((p) => p.slotType === 'bench')).toHaveLength(0);
  });

  it('typed @usernames during the player step are added like taps', async () => {
    const alice = bot.player(41, 'alice');
    const bob = bot.player(42, 'bob');
    await bot.sendText(alice, '/start');
    await bot.sendText(bob, '/start');

    await bot.sendText(alice, '/match');
    await bot.tap(alice, 'wiz:type:singles');
    await bot.tap(alice, 'wiz:date:2026-02-01');
    await bot.tap(alice, 'wiz:time:1000');
    await bot.sendText(alice, '@bob');
    await bot.tap(alice, 'wiz:done:-');
    await bot.tap(alice, 'wiz:create:-');

    expect(allMatches(harness)).toHaveLength(1);
  });

  it('stale taps and expired wizards answer with hints instead of mutating state', async () => {
    const alice = bot.player(51, 'alice');
    const bob = bot.player(52, 'bob');
    await bot.sendText(alice, '/start');
    await bot.sendText(bob, '/start');

    await bot.sendText(alice, '/match');
    await bot.tap(alice, 'wiz:type:singles');
    await bot.tap(alice, 'wiz:type:doubles'); // stale: already past the type step
    expect(bot.lastAnswerText()).toContain('earlier step');
    expect(bot.wizard.store.get('@alice', harness.clock.now(), 10)?.type).toBe('singles');

    harness.clock.advanceMs(11 * 60 * 1000);
    await bot.tap(alice, 'wiz:date:2026-02-01');
    expect(bot.lastAnswerText()).toContain('expired');
    expect(allMatches(harness)).toHaveLength(0);
  });

  it('/newmatch is retired and hints at /match; /match args parse as before', async () => {
    const alice = bot.player(61, 'alice');
    const bob = bot.player(62, 'bob');
    await bot.sendText(alice, '/start');
    await bot.sendText(bob, '/start');

    await bot.sendText(alice, '/newmatch singles 2026-02-01T18:00:00Z @bob');
    expect(allMatches(harness)).toHaveLength(0);
    expect(bot.sentTexts().some((t) => t.includes('/match'))).toBe(true);

    await bot.sendText(alice, '/match singles 2026-02-01T18:00:00Z @bob');
    expect(allMatches(harness)).toHaveLength(1);
  });

  it('cancel from the summary discards the wizard without creating a match', async () => {
    const alice = bot.player(71, 'alice');
    const bob = bot.player(72, 'bob');
    await bot.sendText(alice, '/start');
    await bot.sendText(bob, '/start');
    const bobDbId = listRegisteredUsers(harness.ctx).find((u) => u.telegramUserId === '@bob')!.id;

    await bot.sendText(alice, '/match');
    await bot.tap(alice, 'wiz:type:singles');
    await bot.tap(alice, 'wiz:date:2026-02-01');
    await bot.tap(alice, 'wiz:time:1830');
    await bot.tap(alice, `wiz:player:${bobDbId}`);
    await bot.tap(alice, 'wiz:done:-');
    await bot.tap(alice, 'wiz:cancel:-');

    expect(allMatches(harness)).toHaveLength(0);
    expect(bot.wizard.store.get('@alice', harness.clock.now(), 10)).toBeUndefined();
  });
});
