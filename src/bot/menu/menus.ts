import { Menu } from '@grammyjs/menu';
import type { Context } from 'grammy';
import type { DomainContext } from '../../domain/types.js';
import { DomainError } from '../../domain/types.js';
import { availableMatchActions } from '../../domain/actions.js';
import { getUpcomingMatchesForUser, getPendingInvitationsView } from '../../domain/schedule.js';
import { confirmMainParticipant, declineMainParticipant, getMainParticipants } from '../../domain/matches.js';
import type { ScheduledMatchView } from '../../domain/schedule.js';
import { confirmBenchStandby, declineBenchStandby } from '../../domain/bench.js';
import { acceptInvitationEntry, declineInvitationEntry } from '../../domain/invitationQueue.js';
import { cancelMatch, retireFromDoublesMatch } from '../../domain/lifecycle.js';
import { buildInviteLink, findUserById, findUserByTelegramId, type UserRecord } from '../../domain/users.js';
import { startWizard, beginRescheduleWizard, type WizardDeps } from '../wizard/handlers.js';
import { telegramIdOf } from '../handlers.js';
import type { PromptStore } from './prompts.js';

export interface MenuDeps {
  wizard: WizardDeps;
  prompts: PromptStore;
}

const MATCH_LIST_CAP = 10;

function shortWhen(scheduledAtMs: number): string {
  const date = new Date(scheduledAtMs);
  const day = date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}

/**
 * Builds the hierarchical /menu tree. One root instance is installed as middleware in
 * index.ts; every submenu renders from live domain queries at render time, and the
 * plugin's fingerprinting re-renders outdated menu messages instead of acting on them.
 */
export function createMenus(domain: DomainContext, deps: MenuDeps): Menu<Context> {
  const menuOptions = { onMenuOutdated: 'Menu updated — tap again.' } as const;

  const userOf = (ctx: Context): UserRecord | undefined => findUserByTelegramId(domain, telegramIdOf(ctx));

  /** "✅ Riverside Club, at 22:00 24 Jul with @bob" — venue, time, and the other main players. */
  function matchLabel(view: ScheduledMatchView, userId: number): string {
    const others = getMainParticipants(domain, view.matchId)
      .filter((p) => p.userId !== userId)
      .map((p) => findUserById(domain, p.userId)?.telegramUserId ?? `user ${p.userId}`);
    const date = new Date(view.scheduledAt);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const status = view.overallStatus === 'confirmed' ? '✅' : '⏳';
    return `${status} ${view.venue ?? 'Venue TBD'}, at ${hh}:${mm} ${date.getUTCDate()} ${month} with ${others.join(', ')}`;
  }

  async function replyError(ctx: Context, err: unknown) {
    if (err instanceof DomainError) return void (await ctx.reply(`Couldn't do that: ${err.message}`));
    console.error(err);
    await ctx.reply('Something went wrong handling that.');
  }

  const root = new Menu<Context>('tp-root', menuOptions)
    .text('🎾 New match', async (ctx) => {
      const user = userOf(ctx);
      if (!user) return void (await ctx.reply('Please send /start first.'));
      await startWizard(ctx, domain, deps.wizard, user);
    })
    .row()
    .submenu('📅 My matches', 'tp-matches')
    .row()
    .submenu('⏳ Pending invites', 'tp-invites')
    .row()
    .text('ℹ️ My info', async (ctx) => {
      const user = userOf(ctx);
      if (!user) return void (await ctx.reply('Please send /start first.'));
      const link = ctx.me?.username ? buildInviteLink(ctx.me.username) : 'unavailable';
      await ctx.reply(
        `You're registered as ${user.telegramUserId} (${user.displayName}).\n` +
          `Friends must open this link and press Start before you can invite them:\n${link}`,
      );
    });

  const matchesMenu = new Menu<Context>('tp-matches', menuOptions);
  matchesMenu.dynamic((ctx, range) => {
    const user = userOf(ctx);
    if (!user) return;
    const upcoming = getUpcomingMatchesForUser(domain, user.id);
    if (upcoming.length === 0) {
      range.text('No upcoming matches', (c) => c.menu.update()).row();
      return;
    }
    for (const view of upcoming.slice(0, MATCH_LIST_CAP)) {
      range
        .submenu({ text: matchLabel(view, user.id), payload: String(view.matchId) }, 'tp-match')
        .row();
    }
    if (upcoming.length > MATCH_LIST_CAP) {
      range.text(`…showing first ${MATCH_LIST_CAP} of ${upcoming.length}`, (c) => c.menu.update()).row();
    }
  });
  matchesMenu.back('‹ Back');

  const matchMenu = new Menu<Context>('tp-match', menuOptions);
  matchMenu.dynamic((ctx, range) => {
    const user = userOf(ctx);
    const matchId = Number(ctx.match);
    if (!user || !Number.isInteger(matchId)) return;
    const payload = String(matchId);

    const view = getUpcomingMatchesForUser(domain, user.id).find((v) => v.matchId === matchId);
    range
      .text(
        { text: view ? matchLabel(view, user.id) : `#${matchId} — no longer active`, payload },
        (c) => c.menu.update(),
      )
      .row();

    const actions = availableMatchActions(domain, matchId, user.id);
    if (actions.venue) {
      range
        .text({ text: '📍 Set venue', payload }, async (c) => {
          const u = userOf(c);
          if (!u) return;
          // One pending text interaction per user: the prompt replaces any wizard.
          deps.wizard.store.clear(u.telegramUserId);
          deps.prompts.start({ telegramUserId: u.telegramUserId, matchId, now: domain.clock.now() });
          await c.reply(`Send the venue for match #${matchId} as a plain message (e.g. "Court 5, Riverside Club").`);
        })
        .row();
    }
    if (actions.reschedule) {
      range
        .text({ text: '🔁 Reschedule', payload }, async (c) => {
          const u = userOf(c);
          if (!u) return;
          await beginRescheduleWizard(c, domain, deps.wizard, u, matchId);
        })
        .row();
    }
    if (actions.retire) {
      range
        .text({ text: '🚪 Retire (bench call-up)', payload }, async (c) => {
          const u = userOf(c);
          if (!u) return;
          try {
            const result = retireFromDoublesMatch(domain, { matchId, retiringUserId: u.id });
            await c.reply(
              result.calledUp
                ? `You've retired from match #${matchId} — calling up the bench.`
                : `You've retired from match #${matchId}. No bench players available — someone may need to cancel.`,
            );
            await c.menu.nav('tp-matches');
          } catch (err) {
            await replyError(c, err);
          }
        })
        .row();
    }
    if (actions.cancel) {
      range.submenu({ text: '❌ Cancel match', payload }, 'tp-cancel').row();
    }

    // Direct t.me links to the other players — opens a normal private chat, no bot relay.
    if (view) {
      const others = getMainParticipants(domain, matchId)
        .filter((p) => p.userId !== user.id)
        .map((p) => findUserById(domain, p.userId))
        .filter((u): u is UserRecord => u !== undefined);
      for (const other of others) {
        const hasUsername = other.telegramUserId.startsWith('@');
        const url = hasUsername
          ? `https://t.me/${other.telegramUserId.slice(1)}`
          : `tg://user?id=${other.telegramUserId.slice('id:'.length)}`;
        range.url(`💬 Text ${hasUsername ? other.telegramUserId : other.displayName}`, url).row();
      }
    }
  });
  matchMenu.back('‹ Back');

  const cancelMenu = new Menu<Context>('tp-cancel', menuOptions);
  cancelMenu.dynamic((ctx, range) => {
    const matchId = Number(ctx.match);
    if (!Number.isInteger(matchId)) return;
    const payload = String(matchId);
    range
      .text({ text: `⚠️ Yes — cancel match #${matchId}`, payload }, async (c) => {
        const u = userOf(c);
        if (!u) return;
        try {
          const result = cancelMatch(domain, matchId, u.id);
          await c.reply(result.alreadyCancelled ? 'That match was already cancelled.' : `Match #${matchId} cancelled.`);
          await c.menu.nav('tp-matches');
        } catch (err) {
          await replyError(c, err);
        }
      })
      .row();
    range.back({ text: '‹ No, keep it', payload });
  });

  const invitesMenu = new Menu<Context>('tp-invites', menuOptions);
  invitesMenu.dynamic((ctx, range) => {
    const user = userOf(ctx);
    if (!user) return;

    const awaitingMe = getUpcomingMatchesForUser(domain, user.id).filter((v) => v.participantStatus === 'invited');
    const offers = getPendingInvitationsView(domain, user.id);
    if (awaitingMe.length === 0 && offers.length === 0) {
      range.text('Nothing pending 🎉', (c) => c.menu.update()).row();
      return;
    }

    for (const view of awaitingMe) {
      const bench = view.slotType === 'bench';
      range
        .text(
          {
            text: `#${view.matchId} ${view.type} — ${shortWhen(view.scheduledAt)}${bench ? ' (bench)' : ''}`,
            payload: String(view.matchId),
          },
          (c) => c.menu.update(),
        )
        .row();
      range
        .text({ text: '✅ Accept', payload: String(view.matchId) }, async (c) => {
          const u = userOf(c);
          if (!u) return;
          try {
            if (bench) confirmBenchStandby(domain, view.matchId, u.id);
            else confirmMainParticipant(domain, view.matchId, u.id);
            await c.menu.update();
          } catch (err) {
            await replyError(c, err);
          }
        })
        .text({ text: '❌ Decline', payload: String(view.matchId) }, async (c) => {
          const u = userOf(c);
          if (!u) return;
          try {
            if (bench) declineBenchStandby(domain, view.matchId, u.id);
            else declineMainParticipant(domain, view.matchId, u.id);
            await c.menu.update();
          } catch (err) {
            await replyError(c, err);
          }
        })
        .row();
    }

    for (const offer of offers) {
      const waiting = offer.status === 'queued';
      range
        .text(
          {
            text: `#${offer.matchId} ${offer.type} — ${shortWhen(offer.scheduledAt)} (queue${waiting ? ' — waiting' : ' offer'})`,
            payload: String(offer.entryId),
          },
          (c) => c.menu.update(),
        )
        .row();
      if (!waiting) {
        range
          .text({ text: '✅ Accept', payload: String(offer.entryId) }, async (c) => {
            const u = userOf(c);
            if (!u) return;
            try {
              acceptInvitationEntry(domain, { entryId: offer.entryId, respondingUserId: u.id });
              await c.menu.update();
            } catch (err) {
              await replyError(c, err);
            }
          })
          .text({ text: '❌ Decline', payload: String(offer.entryId) }, async (c) => {
            const u = userOf(c);
            if (!u) return;
            try {
              declineInvitationEntry(domain, { entryId: offer.entryId, respondingUserId: u.id });
              await c.menu.update();
            } catch (err) {
              await replyError(c, err);
            }
          })
          .row();
      }
    }
  });
  invitesMenu.back('‹ Back');

  root.register(matchesMenu);
  matchesMenu.register(matchMenu);
  matchMenu.register(cancelMenu);
  root.register(invitesMenu);
  return root;
}
