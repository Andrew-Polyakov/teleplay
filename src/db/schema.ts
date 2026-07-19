import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** A person known to the bot, keyed by their Telegram user id. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: text('telegram_user_id').notNull().unique(),
  chatId: text('chat_id').notNull(),
  displayName: text('display_name').notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
});

export type MatchType = 'singles' | 'doubles';
export type MatchStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').$type<MatchType>().notNull(),
  scheduledAt: integer('scheduled_at').notNull(),
  overallStatus: text('overall_status').$type<MatchStatus>().notNull().default('pending'),
  venue: text('venue'),
  /** Staged reschedule target, applied to scheduledAt only once every main participant re-confirms. */
  pendingScheduledAt: integer('pending_scheduled_at'),
  /** Staged reschedule venue, applied to venue only once every main participant re-confirms. */
  pendingVenue: text('pending_venue'),
  reminderSentAt: integer('reminder_sent_at'),
  createdByUserId: integer('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type ParticipantStatus = 'invited' | 'confirmed' | 'declined' | 'standby-confirmed' | 'replaced';
export type SlotType = 'main' | 'bench';

export const matchParticipants = sqliteTable('match_participants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: integer('match_id')
    .notNull()
    .references(() => matches.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  slotType: text('slot_type').$type<SlotType>().notNull(),
  participantStatus: text('participant_status').$type<ParticipantStatus>().notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 'closed' = never invited because another candidate for the same slot was accepted first. */
export type InvitationQueueStatus = 'queued' | 'invited' | 'accepted' | 'declined' | 'expired' | 'closed';

export const invitationQueueEntries = sqliteTable('invitation_queue_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: integer('match_id')
    .notNull()
    .references(() => matches.id),
  slotType: text('slot_type').$type<SlotType>().notNull(),
  /** Distinguishes multiple open slots of the same slotType on one match (e.g. two open main slots). */
  slotIndex: integer('slot_index').notNull().default(0),
  sequencePosition: integer('sequence_position').notNull(),
  candidateUserId: integer('candidate_user_id')
    .notNull()
    .references(() => users.id),
  status: text('status').$type<InvitationQueueStatus>().notNull().default('queued'),
  /** The organizer/declarer to notify if the queue is exhausted. */
  declaredByUserId: integer('declared_by_user_id')
    .notNull()
    .references(() => users.id),
  invitedAt: integer('invited_at'),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
