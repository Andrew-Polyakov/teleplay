import { eq } from 'drizzle-orm';
import type { Bot } from 'grammy';
import { users } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';
import type { Notifier } from '../domain/types.js';
import { keyboardForAction } from './keyboards.js';

/** Wires the domain layer's abstract Notifier to real Telegram messages. */
export function createTelegramNotifier(bot: Bot, db: AppDatabase): Notifier {
  return async (userId, text, action) => {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return;
    try {
      await bot.api.sendMessage(user.chatId, text, {
        reply_markup: action ? keyboardForAction(action) : undefined,
      });
    } catch (err) {
      console.error(`Failed to notify user ${userId} (chat ${user.chatId}):`, err);
    }
  };
}
