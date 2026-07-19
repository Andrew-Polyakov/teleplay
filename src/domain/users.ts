import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import type { DomainContext } from './types.js';

export interface UserRecord {
  id: number;
  telegramUserId: string;
  chatId: string;
  displayName: string;
  firstSeenAt: number;
}

/** Records (or refreshes) a user's chat id. Called on `/start` — this is what makes them invitable. */
export function registerUser(
  ctx: DomainContext,
  input: { telegramUserId: string; chatId: string; displayName: string },
): UserRecord {
  const existing = ctx.db.select().from(users).where(eq(users.telegramUserId, input.telegramUserId)).get();
  if (existing) {
    ctx.db
      .update(users)
      .set({ chatId: input.chatId, displayName: input.displayName })
      .where(eq(users.id, existing.id))
      .run();
    return { ...existing, chatId: input.chatId, displayName: input.displayName };
  }

  const now = ctx.clock.now().getTime();
  const inserted = ctx.db
    .insert(users)
    .values({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      displayName: input.displayName,
      firstSeenAt: now,
    })
    .returning()
    .get();
  return inserted;
}

/** Looks up a user who has already started the bot. Returns undefined if they haven't (bot can't DM them yet). */
export function findUserByTelegramId(ctx: DomainContext, telegramUserId: string): UserRecord | undefined {
  return ctx.db.select().from(users).where(eq(users.telegramUserId, telegramUserId)).get();
}

export function findUserById(ctx: DomainContext, id: number): UserRecord | undefined {
  return ctx.db.select().from(users).where(eq(users.id, id)).get();
}

/** Builds the shareable deep-link a creator can forward to someone who hasn't started the bot yet. */
export function buildInviteLink(botUsername: string): string {
  return `https://t.me/${botUsername}?start=invite`;
}
