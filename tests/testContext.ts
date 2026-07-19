import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/db/schema.js';
import type { DomainContext, Clock, Notifier } from '../src/domain/types.js';

export class ManualClock implements Clock {
  private current: Date;
  constructor(start: Date) {
    this.current = start;
  }
  now(): Date {
    return this.current;
  }
  advanceMs(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date) {
    this.current = date;
  }
}

export interface SentMessage {
  userId: number;
  text: string;
}

export function createTestContext(startAt = new Date('2026-01-01T00:00:00.000Z')) {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });

  const clock = new ManualClock(startAt);
  const sent: SentMessage[] = [];
  const notify: Notifier = (userId, text) => {
    sent.push({ userId, text });
  };

  const ctx: DomainContext = { db, clock, notify };
  return { ctx, clock, sent, sqlite };
}
