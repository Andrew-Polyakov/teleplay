import type { InlineKeyboard } from 'grammy';
import type { MatchType } from '../../db/schema.js';
import type { DomainContext } from '../../domain/types.js';
import { DomainError } from '../../domain/types.js';
import { buildInviteLink, findUserById, listRegisteredUsers, type UserRecord } from '../../domain/users.js';
import { createMatch, UnregisteredParticipantError, getMatch, formatMatchSummary } from '../../domain/matches.js';
import { proposeReschedule } from '../../domain/lifecycle.js';
import { dateKey, requiredOtherMainCount, WizardStore, type WizardState } from './state.js';
import {
  calendarKeyboard,
  matchTypeKeyboard,
  playerPickerKeyboard,
  summaryKeyboard,
  timeSlotKeyboard,
  type PickerUser,
} from './keyboards.js';
import { describeInvitees } from '../messages.js';

export interface WizardConfig {
  /** 'HH:MM' bounds and step for the time-slot grid. */
  timeStart: string;
  timeEnd: string;
  timeStepMinutes: number;
  timeoutMinutes: number;
}

export interface WizardDeps {
  store: WizardStore;
  config: WizardConfig;
  /** One pending text interaction per user: starting a wizard discards any menu prompt. */
  prompts?: { clear(telegramUserId: string): void };
}

/**
 * Structural subset of grammY's Context the wizard touches — the live bot passes the real
 * Context; tests pass a plain object.
 */
export interface WizardChatCtx {
  chat?: { id: number };
  me?: { username?: string };
  message?: { text?: string };
  reply(text: string, other?: { reply_markup?: InlineKeyboard }): Promise<{ message_id: number }>;
  api: {
    editMessageText(
      chatId: number,
      messageId: number,
      text: string,
      other?: { reply_markup?: InlineKeyboard },
    ): Promise<unknown>;
  };
}

export interface WizardCallbackCtx extends WizardChatCtx {
  answerCallbackQuery(other?: { text?: string }): Promise<unknown>;
}

const EXPIRED_HINT = 'This wizard has expired — send /match to start again.';
const STALE_HINT = 'That button is from an earlier step — the wizard has moved on.';

function combineDateTime(date: string, timeHHMM: string): Date {
  return new Date(`${date}T${timeHHMM.slice(0, 2)}:${timeHHMM.slice(2)}:00.000Z`);
}

function formatTime(timeHHMM: string): string {
  return `${timeHHMM.slice(0, 2)}:${timeHHMM.slice(2)}`;
}

function pickerUsers(domain: DomainContext, creator: string): PickerUser[] {
  return listRegisteredUsers(domain)
    .filter((u) => u.telegramUserId !== creator)
    .map((u) => ({
      dbId: u.id,
      telegramUserId: u.telegramUserId,
      label: u.telegramUserId.startsWith('@') ? u.telegramUserId : u.displayName,
    }));
}

function summaryText(state: WizardState): string {
  const lines = [
    `New ${state.type} match`,
    `📅 ${state.date} ${formatTime(state.time!)} UTC`,
    `👥 You + ${state.players.join(', ')}`,
  ];
  if (state.type === 'doubles') lines.push(`🪑 Bench: ${state.bench.length ? state.bench.join(', ') : 'none'}`);
  lines.push('', 'Create it?');
  return lines.join('\n');
}

function renderStep(
  state: WizardState,
  domain: DomainContext,
  deps: WizardDeps,
): { text: string; keyboard: InlineKeyboard } {
  switch (state.step) {
    case 'type':
      return { text: 'New match — singles or doubles?', keyboard: matchTypeKeyboard() };
    case 'date':
      return {
        text:
          state.mode === 'reschedule'
            ? `Reschedule match #${state.matchId} — pick a new date (UTC):`
            : `New ${state.type} match — pick a date (UTC):`,
        keyboard: calendarKeyboard(state.calendarMonth, domain.clock.now()),
      };
    case 'time':
      return {
        text:
          state.mode === 'reschedule'
            ? `Reschedule match #${state.matchId} to ${state.date} — pick a time (UTC):`
            : `New ${state.type} match on ${state.date} — pick a time (UTC):`,
        keyboard: timeSlotKeyboard(deps.config.timeStart, deps.config.timeEnd, deps.config.timeStepMinutes),
      };
    case 'players': {
      const remaining = requiredOtherMainCount(state.type!) - state.players.length;
      const selected = state.players.length ? state.players.join(', ') : 'nobody yet';
      return {
        text:
          `Pick the other ${requiredOtherMainCount(state.type!)} player(s) — tap below, or type @usernames ` +
          `(for players who haven't started the bot).\nSelected: ${selected}`,
        keyboard: playerPickerKeyboard(pickerUsers(domain, state.telegramUserId), state.players, state.page, {
          remaining: Math.max(0, remaining),
          skippable: false,
        }),
      };
    }
    case 'bench': {
      const selected = state.bench.length ? state.bench.join(', ') : 'nobody yet';
      return {
        text: `Optional: pick bench (standby) players — tap below or type @usernames.\nSelected: ${selected}`,
        keyboard: playerPickerKeyboard(
          pickerUsers(domain, state.telegramUserId).filter((u) => !state.players.includes(u.telegramUserId)),
          state.bench,
          state.page,
          { skippable: true },
        ),
      };
    }
    case 'summary': {
      if (state.mode === 'reschedule') {
        const match = getMatch(domain, state.matchId!);
        const current = match ? formatMatchSummary(match) : `match #${state.matchId}`;
        return {
          text:
            `Reschedule: ${current}\n→ new time: ${state.date} ${formatTime(state.time!)} UTC\n\n` +
            'Everyone else will need to re-confirm. Propose it?',
          keyboard: summaryKeyboard('Propose reschedule'),
        };
      }
      return { text: summaryText(state), keyboard: summaryKeyboard() };
    }
  }
}

async function rerender(ctx: WizardChatCtx, state: WizardState, domain: DomainContext, deps: WizardDeps) {
  if (state.messageId === undefined) return;
  const { text, keyboard } = renderStep(state, domain, deps);
  try {
    await ctx.api.editMessageText(state.chatId, state.messageId, text, { reply_markup: keyboard });
  } catch (err) {
    // Telegram rejects no-op edits ("message is not modified") — harmless for a re-render.
    console.error('Wizard re-render failed:', err instanceof Error ? err.message : err);
  }
}

/** Entry point for a bare `/match`: replaces any wizard the user already has in flight. */
export async function startWizard(ctx: WizardChatCtx, domain: DomainContext, deps: WizardDeps, user: UserRecord) {
  await beginWizard(ctx, domain, deps, user, { mode: 'create' });
}

/** Menu entry point: pick a new date/time for an existing match, then propose the reschedule. */
export async function beginRescheduleWizard(
  ctx: WizardChatCtx,
  domain: DomainContext,
  deps: WizardDeps,
  user: UserRecord,
  matchId: number,
) {
  await beginWizard(ctx, domain, deps, user, { mode: 'reschedule', matchId });
}

async function beginWizard(
  ctx: WizardChatCtx,
  domain: DomainContext,
  deps: WizardDeps,
  user: UserRecord,
  opts: { mode: 'create' | 'reschedule'; matchId?: number },
) {
  if (!ctx.chat) return;
  deps.prompts?.clear(user.telegramUserId);
  const state = deps.store.start({
    telegramUserId: user.telegramUserId,
    chatId: ctx.chat.id,
    now: domain.clock.now(),
    mode: opts.mode,
    matchId: opts.matchId,
  });
  const { text, keyboard } = renderStep(state, domain, deps);
  const message = await ctx.reply(text, { reply_markup: keyboard });
  state.messageId = message.message_id;
}

export async function handleWizardCallback(
  ctx: WizardCallbackCtx,
  domain: DomainContext,
  deps: WizardDeps,
  user: UserRecord,
  action: string | undefined,
  value: string | undefined,
) {
  if (action === 'noop') return void (await ctx.answerCallbackQuery());

  const now = domain.clock.now();
  const state = deps.store.get(user.telegramUserId, now, deps.config.timeoutMinutes);
  if (!state) return void (await ctx.answerCallbackQuery({ text: EXPIRED_HINT }));
  deps.store.touch(state, now);

  const stale = () => ctx.answerCallbackQuery({ text: STALE_HINT });

  switch (action) {
    case 'cancel': {
      deps.store.clear(user.telegramUserId);
      if (state.messageId !== undefined) {
        try {
          await ctx.api.editMessageText(state.chatId, state.messageId, 'Match creation cancelled.');
        } catch {
          /* the message may be gone; cancelling still succeeded */
        }
      }
      return void (await ctx.answerCallbackQuery({ text: 'Cancelled.' }));
    }
    case 'type': {
      if (state.step !== 'type') return void (await stale());
      if (value !== 'singles' && value !== 'doubles') return void (await stale());
      state.type = value as MatchType;
      state.step = 'date';
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'cal': {
      if (state.step !== 'date') return void (await stale());
      if (!value || !/^\d{4}-\d{2}$/.test(value)) return void (await stale());
      state.calendarMonth = value;
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'date': {
      if (state.step !== 'date') return void (await stale());
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return void (await stale());
      if (value < dateKey(now)) return void (await ctx.answerCallbackQuery({ text: "That date is in the past." }));
      state.date = value;
      state.step = 'time';
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'time': {
      if (state.step !== 'time') return void (await stale());
      if (!value || !/^\d{4}$/.test(value)) return void (await stale());
      state.time = value;
      // A reschedule already has its players — go straight to the confirmation.
      state.step = state.mode === 'reschedule' ? 'summary' : 'players';
      state.page = 0;
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'player': {
      if (state.step !== 'players' && state.step !== 'bench') return void (await stale());
      const target = findUserById(domain, Number(value));
      if (!target || target.telegramUserId === user.telegramUserId) return void (await stale());
      const list = state.step === 'players' ? state.players : state.bench;
      const index = list.indexOf(target.telegramUserId);
      if (index >= 0) {
        list.splice(index, 1);
      } else if (state.step === 'players' && list.length >= requiredOtherMainCount(state.type!)) {
        return void (await ctx.answerCallbackQuery({ text: 'All slots are filled — deselect someone first, or tap Done.' }));
      } else if (state.step === 'bench' && state.players.includes(target.telegramUserId)) {
        return void (await ctx.answerCallbackQuery({ text: "They're already playing in this match." }));
      } else {
        list.push(target.telegramUserId);
      }
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'page': {
      if (state.step !== 'players' && state.step !== 'bench') return void (await stale());
      state.page = Math.max(0, Number(value) || 0);
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'done': {
      if (state.step === 'players') {
        if (state.players.length !== requiredOtherMainCount(state.type!)) return void (await stale());
        state.step = state.type === 'doubles' ? 'bench' : 'summary';
        state.page = 0;
      } else if (state.step === 'bench') {
        state.step = 'summary';
      } else {
        return void (await stale());
      }
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'skip': {
      if (state.step !== 'bench') return void (await stale());
      state.bench = [];
      state.step = 'summary';
      await rerender(ctx, state, domain, deps);
      return void (await ctx.answerCallbackQuery());
    }
    case 'create': {
      if (state.step !== 'summary') return void (await stale());
      if (state.mode === 'reschedule') {
        try {
          proposeReschedule(domain, {
            matchId: state.matchId!,
            proposerUserId: user.id,
            newScheduledAt: combineDateTime(state.date!, state.time!),
          });
          deps.store.clear(user.telegramUserId);
          if (state.messageId !== undefined) {
            try {
              await ctx.api.editMessageText(
                state.chatId,
                state.messageId,
                `🔁 Reschedule proposed for match #${state.matchId} — waiting for the other players to re-confirm.`,
              );
            } catch {
              /* the proposal went through either way */
            }
          }
          return void (await ctx.answerCallbackQuery({ text: 'Reschedule proposed.' }));
        } catch (err) {
          const text = err instanceof DomainError ? err.message : 'Something went wrong proposing the reschedule.';
          if (!(err instanceof DomainError)) console.error(err);
          return void (await ctx.answerCallbackQuery({ text }));
        }
      }
      try {
        const match = createMatch(domain, {
          type: state.type!,
          scheduledAt: combineDateTime(state.date!, state.time!),
          creatorTelegramUserId: user.telegramUserId,
          otherMainParticipants: state.players.map((tid) => ({ kind: 'direct' as const, telegramUserId: tid })),
          benchTelegramUserIds: state.bench,
        });
        deps.store.clear(user.telegramUserId);
        if (state.messageId !== undefined) {
          try {
            await ctx.api.editMessageText(
              state.chatId,
              state.messageId,
              `✅ Match ${match.id} created (${state.type})${describeInvitees(
                state.players.map((tid) => ({ kind: 'direct' as const, telegramUserId: tid })),
                state.bench,
              )}. Invitations sent.`,
            );
          } catch {
            /* match is created either way */
          }
        }
        return void (await ctx.answerCallbackQuery({ text: 'Match created!' }));
      } catch (err) {
        if (err instanceof UnregisteredParticipantError) {
          const link = ctx.me?.username ? ` Forward them this link: ${buildInviteLink(ctx.me.username)}` : '';
          await ctx.reply(`${err.telegramUserId} hasn't started the bot yet.${link}`);
          return void (await ctx.answerCallbackQuery({ text: `${err.telegramUserId} hasn't started the bot.` }));
        }
        const text = err instanceof DomainError ? err.message : 'Something went wrong creating the match.';
        if (!(err instanceof DomainError)) console.error(err);
        return void (await ctx.answerCallbackQuery({ text }));
      }
    }
    default:
      return void (await stale());
  }
}

/**
 * Typed-`@username` escape hatch: while the wizard is on a picker step, a plain text
 * message adds those usernames as if tapped. Returns false when the message isn't for
 * the wizard so the caller can let it fall through.
 */
export async function handleWizardText(
  ctx: WizardChatCtx,
  domain: DomainContext,
  deps: WizardDeps,
  user: UserRecord,
): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith('/')) return false;

  const now = domain.clock.now();
  const state = deps.store.get(user.telegramUserId, now, deps.config.timeoutMinutes);
  if (!state || (state.step !== 'players' && state.step !== 'bench')) return false;

  const mentioned = text.match(/@\w+/g);
  if (!mentioned) return false;
  deps.store.touch(state, now);

  const list = state.step === 'players' ? state.players : state.bench;
  const limit = state.step === 'players' ? requiredOtherMainCount(state.type!) : Number.POSITIVE_INFINITY;
  const added: string[] = [];
  const skipped: string[] = [];
  for (const raw of new Set(mentioned)) {
    if (raw === user.telegramUserId || list.includes(raw) || (state.step === 'bench' && state.players.includes(raw))) {
      skipped.push(raw);
    } else if (list.length >= limit) {
      skipped.push(raw);
    } else {
      list.push(raw);
      added.push(raw);
    }
  }

  await rerender(ctx, state, domain, deps);
  if (added.length === 0) {
    await ctx.reply(`Couldn't add ${skipped.join(', ')} — already selected, already playing, or no slots left.`);
  } else if (skipped.length > 0) {
    await ctx.reply(`Added ${added.join(', ')}. Skipped ${skipped.join(', ')}.`);
  }
  return true;
}
