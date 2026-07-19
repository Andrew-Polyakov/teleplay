import type { DomainContext } from '../domain/types.js';
import { sendDueReminders } from '../domain/reminders.js';
import { expireDueInvitations } from '../domain/invitationQueue.js';

export interface WorkerHandle {
  stop(): void;
}

/** Starts the reminder + invitation-expiry polling workers. Both wrap plain, unit-tested functions. */
export function startWorkers(
  domain: DomainContext,
  config: {
    reminderLeadHours: number;
    reminderPollIntervalMinutes: number;
    invitationPollIntervalMinutes: number;
  },
): WorkerHandle {
  const reminderTimer = setInterval(
    () => {
      try {
        sendDueReminders(domain, config.reminderLeadHours);
      } catch (err) {
        console.error('Reminder worker error:', err);
      }
    },
    config.reminderPollIntervalMinutes * 60 * 1000,
  );

  const invitationTimer = setInterval(
    () => {
      try {
        expireDueInvitations(domain);
      } catch (err) {
        console.error('Invitation-expiry worker error:', err);
      }
    },
    config.invitationPollIntervalMinutes * 60 * 1000,
  );

  return {
    stop() {
      clearInterval(reminderTimer);
      clearInterval(invitationTimer);
    },
  };
}
