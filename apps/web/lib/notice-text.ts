import type { Copy } from './copy';
import type { NoticeRow } from './api';
import { formatShekel } from './money';
import { actionName } from '../components/names';

// A notice arrives as a kind and a payload; the sentence is built here, in the user's language.

export function noticeTitle(t: Copy, row: NoticeRow): string {
  switch (row.kind) {
    case 'task.opened': return t.noticeTask;
    case 'task.taken': return t.noticeTaken;
    case 'task.released': return t.noticeReleased;
    case 'task.note': return t.noticeNote;
    case 'task.done': return t.noticeDone;
    case 'task.rejected': return t.noticeRejected;
    case 'task.cancelled': return t.noticeCancelled;
    case 'fund.received': return t.noticeFund;
    case 'fund.deducted': return t.noticeDeducted;
    case 'wallet.negative': return t.noticeNegative;
    case 'wallet.ceiling': return t.noticeCeiling;
    case 'announcement': return t.noticeAnnouncement;
    case 'transfer.out': return t.noticeTransferOut;
    case 'transfer.in': return t.noticeTransferIn;
    case 'provider.problem': return t.noticeProviderProblem;
    case 'provider.recovered': return t.noticeProviderRecovered;
    default: return row.kind;
  }
}

export function noticeDetail(t: Copy, row: NoticeRow): string {
  const p = row.payload ?? {};
  const parts: string[] = [];
  if (row.kind.startsWith('task.')) {
    if (p.action) parts.push(actionName(t, p.action));
    if (p.msisdn) parts.push(p.msisdn);
    if (p.packageName) parts.push(p.packageName);
    if (row.kind === 'task.done' && typeof p.amount === 'number' && p.amount !== 0) parts.push(formatShekel(p.amount));
    if (row.kind === 'task.opened' && typeof p.amount === 'number' && p.amount !== 0) parts.push(formatShekel(p.amount));
    if (row.kind === 'task.rejected' && p.reason) parts.push(p.reason);
    if (row.kind === 'task.note' && p.excerpt) parts.push(p.excerpt);
    const who = p.handlerName || p.authorName || row.actorName;
    if (who) parts.push(`${t.noticeBy} ${who}`);
    return parts.join(' · ');
  }
  if (row.kind === 'fund.received' || row.kind === 'fund.deducted') {
    if (typeof p.amount === 'number') parts.push(formatShekel(p.amount));
    if (p.senderName) parts.push(`${t.noticeFrom} ${p.senderName}`);
    if (p.note) parts.push(p.note);
    return parts.join(' · ');
  }
  if (row.kind === 'wallet.negative' || row.kind === 'wallet.ceiling') {
    if (p.loginName) parts.push(`${t.noticeAccount} ${p.loginName}`);
    if (row.kind === 'wallet.ceiling' && typeof p.attempted === 'number') parts.push(`${t.noticeAttempted} ${formatShekel(p.attempted)}`);
    if (typeof p.balance === 'number') parts.push(`${t.noticeBalance} ${formatShekel(p.balance)}`);
    if (typeof p.ceiling === 'number') parts.push(`${t.noticeCeilingWord} ${formatShekel(p.ceiling)}`);
    return parts.join(' · ');
  }
  if (row.kind === 'announcement') {
    if (p.authorName) parts.push(p.authorName);
    if (p.excerpt) parts.push(p.excerpt);
    return parts.join(' · ');
  }
  if (row.kind === 'transfer.out' || row.kind === 'transfer.in') {
    // What moved, then the account it went to (out) or came from (in), then who moved it.
    if (p.subject) parts.push(p.subject);
    if (row.kind === 'transfer.out' && p.toLogin) parts.push(`${t.noticeTo} ${p.toLogin}`);
    if (row.kind === 'transfer.in' && p.fromLogin) parts.push(`${t.noticeFrom} ${p.fromLogin}`);
    const who = p.actorName || row.actorName;
    if (who) parts.push(`${t.noticeBy} ${who}`);
    return parts.join(' · ');
  }
  if (row.kind === 'provider.problem' || row.kind === 'provider.recovered') {
    if (p.name) parts.push(p.name);
    if (row.kind === 'provider.problem' && p.reason === 'failures') parts.push(t.providerProblemFailures.replace('{n}', String(p.failures ?? 0)));
    if (row.kind === 'provider.problem' && p.reason === 'balance') parts.push(`${t.providerAvailable} ${formatShekel(p.available ?? 0)}`);
    return parts.join(' · ');
  }
  return row.actorName;
}

export function noticeAge(t: Copy, iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return t.minutesAgo.replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.hoursAgo.replace('{n}', String(hours));
  return t.daysAgo.replace('{n}', String(Math.floor(hours / 24)));
}

export function noticeGroup(kind: string): 'tasks' | 'wallet' | 'announcements' | 'providers' {
  if (kind.startsWith('task.')) return 'tasks';
  if (kind.startsWith('provider.')) return 'providers';
  if (kind === 'announcement') return 'announcements';
  return 'wallet';
}
