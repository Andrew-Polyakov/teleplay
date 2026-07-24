import { InlineKeyboard } from 'grammy';

/**
 * All wizard callback data uses the existing `namespace:action:value` shape with
 * namespace `wiz`; values never contain `:` so the global dispatcher's split keeps working.
 */
export const NOOP = 'wiz:noop:-';

/** How many months ahead of the current one the calendar can navigate. */
export const CALENDAR_HORIZON_MONTHS = 14;

const PAGE_SIZE = 8;

export function matchTypeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Singles', 'wiz:type:singles')
    .text('Doubles', 'wiz:type:doubles')
    .row()
    .text('Cancel', 'wiz:cancel:-');
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split('-');
  return { year: Number(y), monthIndex: Number(m) - 1 };
}

function formatMonth(month: string): string {
  const { year, monthIndex } = monthParts(month);
  const name = new Date(Date.UTC(year, monthIndex, 1)).toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${name} ${year}`;
}

function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = monthParts(month);
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

function monthDistance(from: string, to: string): number {
  const a = monthParts(from);
  const b = monthParts(to);
  return (b.year - a.year) * 12 + (b.monthIndex - a.monthIndex);
}

/**
 * Month-grid calendar (weeks start Monday). Past days and padding cells are inert;
 * navigation is clamped to [current month, current month + horizon].
 */
export function calendarKeyboard(month: string, today: Date): InlineKeyboard {
  const currentMonth = today.toISOString().slice(0, 7);
  const todayKey = today.toISOString().slice(0, 10);
  const { year, monthIndex } = monthParts(month);

  const kb = new InlineKeyboard();
  const canGoBack = monthDistance(currentMonth, month) > 0;
  const canGoForward = monthDistance(currentMonth, month) < CALENDAR_HORIZON_MONTHS;
  kb.text(canGoBack ? '‹' : ' ', canGoBack ? `wiz:cal:${shiftMonth(month, -1)}` : NOOP)
    .text(formatMonth(month), NOOP)
    .text(canGoForward ? '›' : ' ', canGoForward ? `wiz:cal:${shiftMonth(month, 1)}` : NOOP)
    .row();

  for (const day of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) kb.text(day, NOOP);
  kb.row();

  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  // getUTCDay(): 0=Sunday..6=Saturday → leading blanks for a Monday-first grid.
  const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;

  let cellsInRow = 0;
  const cell = (label: string, data: string) => {
    kb.text(label, data);
    cellsInRow += 1;
    if (cellsInRow === 7) {
      kb.row();
      cellsInRow = 0;
    }
  };

  for (let i = 0; i < leadingBlanks; i += 1) cell(' ', NOOP);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    if (dateStr < todayKey) cell('·', NOOP);
    else cell(String(day), `wiz:date:${dateStr}`);
  }
  while (cellsInRow !== 0) cell(' ', NOOP);

  kb.text('Cancel', 'wiz:cancel:-');
  return kb;
}

export function parseHHMM(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

/** Grid of selectable times between start and end (inclusive), `stepMinutes` apart, 4 per row. */
export function timeSlotKeyboard(startHHMM: string, endHHMM: string, stepMinutes: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  let inRow = 0;
  for (let minutes = start; minutes <= end; minutes += stepMinutes) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    kb.text(`${hh}:${mm}`, `wiz:time:${hh}${mm}`);
    inRow += 1;
    if (inRow === 4) {
      kb.row();
      inRow = 0;
    }
  }
  if (inRow !== 0) kb.row();
  kb.text('Cancel', 'wiz:cancel:-');
  return kb;
}

export interface PickerUser {
  dbId: number;
  telegramUserId: string;
  label: string;
}

export interface PickerOptions {
  /** Slots still to fill; when 0 the Done button is live. Pass undefined for the (unbounded) bench step. */
  remaining?: number;
  /** Bench step: offer Skip alongside Done. */
  skippable: boolean;
}

/**
 * Paginated toggle-list of registered users. Selection toggles are `wiz:player:<dbId>`
 * (db ids keep callback values colon-free — telegram ids can contain `:`).
 */
export function playerPickerKeyboard(
  users: PickerUser[],
  selected: string[],
  page: number,
  opts: PickerOptions,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const pageCount = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const boundedPage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageUsers = users.slice(boundedPage * PAGE_SIZE, (boundedPage + 1) * PAGE_SIZE);

  let inRow = 0;
  for (const user of pageUsers) {
    const isSelected = selected.includes(user.telegramUserId);
    kb.text(`${isSelected ? '✓ ' : ''}${user.label}`, `wiz:player:${user.dbId}`);
    inRow += 1;
    if (inRow === 2) {
      kb.row();
      inRow = 0;
    }
  }
  if (inRow !== 0) kb.row();

  if (pageCount > 1) {
    kb.text(boundedPage > 0 ? '‹ Prev' : ' ', boundedPage > 0 ? `wiz:page:${boundedPage - 1}` : NOOP)
      .text(`${boundedPage + 1}/${pageCount}`, NOOP)
      .text(boundedPage < pageCount - 1 ? 'Next ›' : ' ', boundedPage < pageCount - 1 ? `wiz:page:${boundedPage + 1}` : NOOP)
      .row();
  }

  if (opts.remaining !== undefined && opts.remaining > 0) {
    kb.text(`Pick ${opts.remaining} more`, NOOP);
  } else {
    kb.text('Done', 'wiz:done:-');
  }
  if (opts.skippable) kb.text('Skip', 'wiz:skip:-');
  kb.text('Cancel', 'wiz:cancel:-');
  return kb;
}

export function summaryKeyboard(confirmLabel = 'Create match'): InlineKeyboard {
  return new InlineKeyboard().text(confirmLabel, 'wiz:create:-').text('Cancel', 'wiz:cancel:-');
}
