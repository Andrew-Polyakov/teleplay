import { and, asc, eq, ne } from 'drizzle-orm';
import { invitationQueueEntries, matchParticipants } from '../db/schema.js';
import type { SlotType } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { DomainError } from './types.js';
import { getMatch, checkAndConfirmMatch, buildMatchDetails, getMainParticipants } from './matches.js';

export interface DeclareCandidateQueueInput {
  matchId: number;
  slotType: SlotType;
  /** Distinguishes multiple concurrently-open slots of the same slotType on one match. */
  slotIndex: number;
  candidateUserIds: number[];
  declaredByUserId: number;
}

function invitationTimeoutMs(ctx: DomainContext): number {
  // Matches the invitation-queue spec's fixed 1-hour response window.
  void ctx;
  return 60 * 60 * 1000;
}

function slotEntries(ctx: DomainContext, matchId: number, slotType: SlotType, slotIndex: number) {
  return ctx.db
    .select()
    .from(invitationQueueEntries)
    .where(
      and(
        eq(invitationQueueEntries.matchId, matchId),
        eq(invitationQueueEntries.slotType, slotType),
        eq(invitationQueueEntries.slotIndex, slotIndex),
      ),
    )
    .orderBy(asc(invitationQueueEntries.sequencePosition))
    .all();
}

function buildInvitationMessage(ctx: DomainContext, matchId: number, recipientUserId: number): string {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  return `🎾 You're invited to play a ${match.type} match\n${buildMatchDetails(ctx, matchId, recipientUserId)}\nReply within 1 hour to accept.`;
}

/** Activates the next `queued` entry for a slot, or notifies the declarer if the queue is exhausted. */
function activateNext(ctx: DomainContext, matchId: number, slotType: SlotType, slotIndex: number) {
  const entries = slotEntries(ctx, matchId, slotType, slotIndex);
  const next = entries.find((e) => e.status === 'queued');
  const now = ctx.clock.now().getTime();

  if (!next) {
    const anyAccepted = entries.some((e) => e.status === 'accepted');
    if (!anyAccepted) {
      const declarer = entries[0]?.declaredByUserId;
      if (declarer !== undefined) {
        ctx.notify(declarer, `No candidate accepted the invitation queue for match ${matchId}.`);
      }
    }
    return;
  }

  ctx.db
    .update(invitationQueueEntries)
    .set({ status: 'invited', invitedAt: now, expiresAt: now + invitationTimeoutMs(ctx), updatedAt: now })
    .where(eq(invitationQueueEntries.id, next.id))
    .run();
  ctx.notify(next.candidateUserId, buildInvitationMessage(ctx, matchId, next.candidateUserId), {
    kind: 'invitationOffer',
    entryId: next.id,
  });
}

export function declareCandidateQueue(ctx: DomainContext, input: DeclareCandidateQueueInput) {
  const now = ctx.clock.now().getTime();
  input.candidateUserIds.forEach((candidateUserId, index) => {
    ctx.db
      .insert(invitationQueueEntries)
      .values({
        matchId: input.matchId,
        slotType: input.slotType,
        slotIndex: input.slotIndex,
        sequencePosition: index + 1,
        candidateUserId,
        declaredByUserId: input.declaredByUserId,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
  activateNext(ctx, input.matchId, input.slotType, input.slotIndex);
}

function fillSlotFromAcceptedEntry(
  ctx: DomainContext,
  entry: typeof invitationQueueEntries.$inferSelect,
) {
  const now = ctx.clock.now().getTime();
  ctx.db
    .insert(matchParticipants)
    .values({
      matchId: entry.matchId,
      userId: entry.candidateUserId,
      slotType: entry.slotType,
      participantStatus: entry.slotType === 'main' ? 'confirmed' : 'standby-confirmed',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  if (entry.slotType === 'main') {
    const others = getMainParticipants(ctx, entry.matchId).filter((p) => p.userId !== entry.candidateUserId);
    for (const other of others) {
      ctx.notify(other.userId, `${entry.candidateUserId} has joined your match.`);
    }
    checkAndConfirmMatch(ctx, entry.matchId);
  }
}

export interface RespondToInvitationInput {
  entryId: number;
  respondingUserId: number;
}

export function acceptInvitationEntry(ctx: DomainContext, input: RespondToInvitationInput) {
  const entry = ctx.db
    .select()
    .from(invitationQueueEntries)
    .where(eq(invitationQueueEntries.id, input.entryId))
    .get();
  if (!entry) throw new DomainError(`Invitation queue entry ${input.entryId} not found`);
  if (entry.candidateUserId !== input.respondingUserId) {
    throw new DomainError('Only the invited candidate can accept this invitation');
  }
  if (entry.status !== 'invited') {
    throw new DomainError('This invitation is no longer active — the slot may already be filled');
  }

  const now = ctx.clock.now().getTime();
  ctx.db
    .update(invitationQueueEntries)
    .set({ status: 'accepted', updatedAt: now })
    .where(eq(invitationQueueEntries.id, entry.id))
    .run();

  // Close out every other still-open entry for this slot — the vacancy is filled.
  ctx.db
    .update(invitationQueueEntries)
    .set({ status: 'closed', updatedAt: now })
    .where(
      and(
        eq(invitationQueueEntries.matchId, entry.matchId),
        eq(invitationQueueEntries.slotType, entry.slotType),
        eq(invitationQueueEntries.slotIndex, entry.slotIndex),
        ne(invitationQueueEntries.id, entry.id),
      ),
    )
    .run();

  fillSlotFromAcceptedEntry(ctx, entry);
  return entry;
}

export function declineInvitationEntry(ctx: DomainContext, input: RespondToInvitationInput) {
  const entry = ctx.db
    .select()
    .from(invitationQueueEntries)
    .where(eq(invitationQueueEntries.id, input.entryId))
    .get();
  if (!entry) throw new DomainError(`Invitation queue entry ${input.entryId} not found`);
  if (entry.candidateUserId !== input.respondingUserId) {
    throw new DomainError('Only the invited candidate can decline this invitation');
  }
  if (entry.status !== 'invited') {
    throw new DomainError('This invitation is no longer active');
  }

  const now = ctx.clock.now().getTime();
  ctx.db
    .update(invitationQueueEntries)
    .set({ status: 'declined', updatedAt: now })
    .where(eq(invitationQueueEntries.id, entry.id))
    .run();

  activateNext(ctx, entry.matchId, entry.slotType, entry.slotIndex);
  return entry;
}

/** Polling worker: expires any invitation whose 1-hour window has elapsed and advances its queue. */
export function expireDueInvitations(ctx: DomainContext) {
  const now = ctx.clock.now().getTime();
  const due = ctx.db
    .select()
    .from(invitationQueueEntries)
    .where(eq(invitationQueueEntries.status, 'invited'))
    .all()
    .filter((e) => e.expiresAt !== null && e.expiresAt <= now);

  for (const entry of due) {
    ctx.db
      .update(invitationQueueEntries)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(invitationQueueEntries.id, entry.id))
      .run();
    activateNext(ctx, entry.matchId, entry.slotType, entry.slotIndex);
  }
  return due.length;
}

export function getPendingInvitationsForUser(ctx: DomainContext, userId: number) {
  return ctx.db
    .select()
    .from(invitationQueueEntries)
    .where(eq(invitationQueueEntries.candidateUserId, userId))
    .all()
    .filter((e) => e.status === 'queued' || e.status === 'invited');
}
