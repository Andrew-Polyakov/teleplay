import type { Bot, Context } from 'grammy';
import type { DomainContext } from '../domain/types.js';
import { DomainError } from '../domain/types.js';
import { registerUser, findUserByTelegramId, buildInviteLink } from '../domain/users.js';
import { createMatch, confirmMainParticipant, declineMainParticipant, UnregisteredParticipantError } from '../domain/matches.js';
import { addBenchPlayers, confirmBenchStandby, declineBenchStandby } from '../domain/bench.js';
import { submitVenue } from '../domain/venue.js';
import { cancelMatch, proposeReschedule, retireFromDoublesMatch } from '../domain/lifecycle.js';
import { acceptInvitationEntry, declineInvitationEntry } from '../domain/invitationQueue.js';
import { getUpcomingMatchesForUser, getPendingInvitationsView } from '../domain/schedule.js';
import { parseNewMatchArgs, parseRescheduleArgs, parseMatchIdAndText, parseMatchId } from './parse.js';
import { startWizard, handleWizardCallback, handleWizardText, type WizardDeps } from './wizard/handlers.js';
import { describeInvitees } from './messages.js';
import type { Menu } from '@grammyjs/menu';
import type { PromptStore } from './menu/prompts.js';

export interface MenuBundle {
  root: Menu<Context>;
  prompts: PromptStore;
}

export function telegramIdOf(ctx: { from?: { id?: number; username?: string } }): string {
  const username = ctx.from?.username;
  return username ? `@${username}` : `id:${ctx.from?.id}`;
}

function args(ctx: Context): string[] {
  const text = ctx.message?.text ?? '';
  return text.trim().split(/\s+/).slice(1).filter(Boolean);
}

async function requireRegisteredUser(ctx: Context, domain: DomainContext) {
  const tid = telegramIdOf(ctx);
  const user = findUserByTelegramId(domain, tid);
  if (!user) {
    await ctx.reply('Please send /start first so I can message you.');
    return undefined;
  }
  return user;
}

function replyWithError(ctx: Context, err: unknown) {
  if (err instanceof UnregisteredParticipantError) {
    const botUsername = ctx.me?.username;
    const link = botUsername ? ` Forward them this link: ${buildInviteLink(botUsername)}` : '';
    return ctx.reply(`${err.telegramUserId} hasn't started the bot yet.${link}`);
  }
  if (err instanceof DomainError) {
    return ctx.reply(`Couldn't do that: ${err.message}`);
  }
  console.error(err);
  return ctx.reply('Something went wrong handling that.');
}

export function registerHandlers(bot: Bot, domain: DomainContext, wizard: WizardDeps, menu?: MenuBundle) {
  bot.command('start', async (ctx) => {
    const tid = telegramIdOf(ctx);
    if (!ctx.chat) return;
    registerUser(domain, {
      telegramUserId: tid,
      chatId: String(ctx.chat.id),
      displayName: ctx.from?.first_name ?? tid,
    });
    await ctx.reply(
      "Welcome to Teleplay! You're registered. Send /menu to browse everything, or /match to set up a match right away.",
    );
  });

  if (menu) {
    bot.command('menu', async (ctx) => {
      const user = await requireRegisteredUser(ctx, domain);
      if (!user) return;
      await ctx.reply('🎾 Teleplay menu', { reply_markup: menu.root });
    });
  }

  bot.command('match', async (ctx) => {
    const creator = await requireRegisteredUser(ctx, domain);
    if (!creator) return;

    const argList = args(ctx);
    if (argList.length === 0) {
      return void (await startWizard(ctx, domain, wizard, creator));
    }

    const parsed = parseNewMatchArgs(argList);
    if (!parsed.ok) return void (await ctx.reply(parsed.error));

    try {
      const match = createMatch(domain, {
        type: parsed.value.type,
        scheduledAt: parsed.value.scheduledAt,
        creatorTelegramUserId: creator.telegramUserId,
        otherMainParticipants: parsed.value.otherMainParticipants,
        benchTelegramUserIds: parsed.value.benchUsernames,
      });
      await ctx.reply(
        `Match ${match.id} created (${parsed.value.type})${describeInvitees(
          parsed.value.otherMainParticipants,
          parsed.value.benchUsernames,
        )}. Invitations sent.`,
      );
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('newmatch', async (ctx) => {
    await ctx.reply('/newmatch is now /match — send /match to set up a match.');
  });

  bot.command('confirm', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchId(args(ctx), 'Usage: /confirm <matchId>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      const match = confirmMainParticipant(domain, parsed.value.matchId, user.id);
      await ctx.reply(`Confirmed. Match ${match.id} status: ${match.overallStatus}.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('decline', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchId(args(ctx), 'Usage: /decline <matchId>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      declineMainParticipant(domain, parsed.value.matchId, user.id);
      await ctx.reply(`Declined match ${parsed.value.matchId}.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('bench_add', async (ctx) => {
    const requester = await requireRegisteredUser(ctx, domain);
    if (!requester) return;
    const parsed = parseMatchIdAndText(args(ctx), 'Usage: /bench_add <matchId> @user1,@user2,...');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    const usernames = parsed.value.text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('@') ? s : `@${s}`));
    try {
      addBenchPlayers(domain, parsed.value.matchId, usernames);
      await ctx.reply(`Bench invitations sent for match ${parsed.value.matchId}.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('bench_confirm', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchId(args(ctx), 'Usage: /bench_confirm <matchId>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      confirmBenchStandby(domain, parsed.value.matchId, user.id);
      await ctx.reply(`You're on standby for match ${parsed.value.matchId}.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('bench_decline', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchId(args(ctx), 'Usage: /bench_decline <matchId>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      declineBenchStandby(domain, parsed.value.matchId, user.id);
      await ctx.reply(`Declined bench standby for match ${parsed.value.matchId}.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('venue', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchIdAndText(args(ctx), 'Usage: /venue <matchId> <venue text>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      const match = submitVenue(domain, parsed.value.matchId, user.id, parsed.value.text);
      await ctx.reply(`Venue for match ${match.id} set to: ${match.venue}`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('cancel', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchId(args(ctx), 'Usage: /cancel <matchId>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      const result = cancelMatch(domain, parsed.value.matchId, user.id);
      await ctx.reply(result.alreadyCancelled ? 'That match is already cancelled.' : `Match ${parsed.value.matchId} cancelled.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('reschedule', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseRescheduleArgs(args(ctx));
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      proposeReschedule(domain, {
        matchId: parsed.value.matchId,
        proposerUserId: user.id,
        newScheduledAt: parsed.value.newScheduledAt,
        newVenue: parsed.value.newVenue,
      });
      await ctx.reply(`Reschedule proposed for match ${parsed.value.matchId}. Waiting for re-confirmation.`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('retire', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;
    const parsed = parseMatchId(args(ctx), 'Usage: /retire <matchId>');
    if (!parsed.ok) return void (await ctx.reply(parsed.error));
    try {
      const result = retireFromDoublesMatch(domain, { matchId: parsed.value.matchId, retiringUserId: user.id });
      await ctx.reply(
        result.calledUp
          ? `You've retired from match ${parsed.value.matchId}. Calling up the bench.`
          : `You've retired from match ${parsed.value.matchId}. No bench players are available — someone may need to cancel.`,
      );
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });

  bot.command('schedule', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return;

    const upcoming = getUpcomingMatchesForUser(domain, user.id);
    const pending = getPendingInvitationsView(domain, user.id);

    const lines: string[] = [];
    lines.push('Your matches:');
    if (upcoming.length === 0) {
      lines.push('  You have no upcoming matches.');
    } else {
      for (const m of upcoming) {
        const when = new Date(m.scheduledAt).toISOString();
        lines.push(`  #${m.matchId} ${m.type} at ${when} — ${m.venue ?? 'venue TBD'} [${m.overallStatus}, ${m.slotType}]`);
      }
    }

    if (pending.length > 0) {
      lines.push('');
      lines.push('Pending invitations:');
      for (const p of pending) {
        const when = new Date(p.scheduledAt).toISOString();
        const expiry =
          p.status === 'invited' && p.expiresAt
            ? ` (expires in ${Math.max(0, Math.round((p.expiresAt - Date.now()) / 60000))} min)`
            : '';
        lines.push(`  #${p.matchId} ${p.type} at ${when} — ${p.venue ?? 'venue TBD'} [${p.status}${expiry}]`);
      }
    }

    await ctx.reply(lines.join('\n'));
  });

  bot.on('callback_query:data', async (ctx) => {
    const user = await requireRegisteredUser(ctx, domain);
    if (!user) return void (await ctx.answerCallbackQuery());
    const [namespace, action, idRaw] = (ctx.callbackQuery.data ?? '').split(':');
    const id = Number(idRaw);

    if (namespace === 'wiz') {
      return void (await handleWizardCallback(ctx, domain, wizard, user, action, idRaw));
    }

    try {
      let note = 'Done.';
      if (namespace === 'match' && action === 'confirm') {
        const match = confirmMainParticipant(domain, id, user.id);
        note = match?.overallStatus === 'confirmed' ? '✅ You confirmed — everyone is in, match is on!' : '✅ You confirmed.';
      } else if (namespace === 'match' && action === 'decline') {
        declineMainParticipant(domain, id, user.id);
        note = '❌ You declined.';
      } else if (namespace === 'bench' && action === 'confirm') {
        confirmBenchStandby(domain, id, user.id);
        note = "✅ You're on standby.";
      } else if (namespace === 'bench' && action === 'decline') {
        declineBenchStandby(domain, id, user.id);
        note = '❌ You declined the bench spot.';
      } else if (namespace === 'invite' && action === 'accept') {
        acceptInvitationEntry(domain, { entryId: id, respondingUserId: user.id });
        note = "✅ Accepted — you're in.";
      } else if (namespace === 'invite' && action === 'decline') {
        declineInvitationEntry(domain, { entryId: id, respondingUserId: user.id });
        note = '❌ You declined.';
      }

      // Stamp the outcome onto the invitation itself and drop its buttons — the toast
      // alone is easy to miss and leaving live buttons makes the tap look ignored.
      const tapped = ctx.callbackQuery.message;
      if (note !== 'Done.' && tapped && 'text' in tapped && tapped.text) {
        try {
          await ctx.editMessageText(`${tapped.text}\n\n${note}`);
        } catch {
          // Message too old to edit (48h Telegram limit) — the toast still shows.
        }
      }
      await ctx.answerCallbackQuery({ text: note });
    } catch (err) {
      try {
        await ctx.answerCallbackQuery({ text: err instanceof Error ? err.message : 'Error' });
      } catch {
        // Stale callback queries (>~30s old, e.g. queued across a restart) can't be
        // answered at all — dropping the answer is all we can do.
      }
    }
  });

  // Plain-text fallthrough (commands are consumed above): typed @usernames feed an
  // active wizard's player/bench step, then a pending menu prompt (venue entry) may
  // claim the reply; everything else is ignored.
  bot.on('message:text', async (ctx) => {
    const user = findUserByTelegramId(domain, telegramIdOf(ctx));
    if (!user) return;
    if (await handleWizardText(ctx, domain, wizard, user)) return;
    if (!menu || ctx.message.text.startsWith('/')) return;

    const prompt = menu.prompts.get(user.telegramUserId, domain.clock.now(), wizard.config.timeoutMinutes);
    if (!prompt) return;
    menu.prompts.clear(user.telegramUserId);
    try {
      const updated = submitVenue(domain, prompt.matchId, user.id, ctx.message.text.trim());
      await ctx.reply(`📍 Venue for match #${prompt.matchId} set to: ${updated.venue}`);
    } catch (err) {
      await replyWithError(ctx, err);
    }
  });
}
