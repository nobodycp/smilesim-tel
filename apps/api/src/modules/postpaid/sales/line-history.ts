// One number's history as its card shows it. Pure.

type Named = { nickname: string | null; loginName: string };
type HistoryEntry = { id: string; kind: string; createdAt: Date; msisdn: string | null; companyName: string | null; packageName: string | null; actor: Named };
type HistoryTask = {
  id: string; action: string; status: string; posDelta: number; createdAt: Date; updatedAt: Date; msisdn: string | null;
  packageId: string; nextPackageId: string | null; submitter: Named; assignee: Named | null;
};
type NamedPackage = { name: string; company: { name: string } | null };

/** Rows of the card's history kept and shown. */
const HISTORY_ROWS = 40;

/**
 * Wallet entries and tasks of a line, newest first. A finished task that posted an entry is shown once, by its
 * entry; an open or closed-without-money task is shown as itself.
 */
export function lineHistory(
  line: { msisdn: string; package: NamedPackage },
  entries: HistoryEntry[],
  tasks: HistoryTask[],
  byPackage: Map<string, NamedPackage>,
) {
  return [
    ...entries.map((entry) => ({
      id: entry.id,
      action: entry.kind,
      at: entry.createdAt.toISOString(),
      msisdn: entry.msisdn ?? line.msisdn,
      companyName: entry.companyName ?? '',
      packageName: entry.packageName ?? '',
      actorName: entry.actor.nickname || entry.actor.loginName,
    })),
    ...tasks
      .filter((task) => {
        if (task.status !== 'done') return true;
        if (task.posDelta !== 0) return false;
        return !entries.some((entry) => entry.kind === task.action && Math.abs(entry.createdAt.getTime() - task.updatedAt.getTime()) < 5000);
      })
      .map((task) => {
        const pkg = byPackage.get(task.nextPackageId || task.packageId);
        const named = pkg?.company ? pkg : line.package;
        const who = task.status === 'done' && task.assignee ? task.assignee : task.submitter;
        return {
          id: task.id,
          action: task.action,
          at: task.createdAt.toISOString(),
          msisdn: task.msisdn ?? line.msisdn,
          companyName: named.company?.name ?? '',
          packageName: named.name,
          actorName: who.nickname || who.loginName,
        };
      }),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, HISTORY_ROWS);
}
