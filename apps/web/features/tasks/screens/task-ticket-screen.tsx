'use client';

import { Ban, Check, Hand, Undo2, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, actionName, latinWhen, taskStatus } from '../../../components/desk';
import { EsimDialog, EsimMark, QrPicker } from '../../../components/esim-qr';
import { TableSkeleton } from '../../../components/loading';
import { Badge } from '../../../components/ui/badge';
import { useOffice } from '../../../lib/office-session';
import { Button } from '../../../components/ui/button';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint } from '../../../lib/sim-rules';
import { useAction } from '../../../lib/use-action';
import { taskTone } from '../../../lib/status-tone';
import { usePageTitle } from '../../../lib/page-title';
import { Fact, Facts } from '../../../components/facts';
import { useCrumbs } from '../../../lib/crumbs';

const glyph = { size: 14, strokeWidth: 1.95, 'aria-hidden': true as const };

type CloseMode = null | 'complete' | 'reject';

/** Timeline lines come composed from the server; login names inside them keep their own direction. */
function isolateLatin(text: string) {
  return text.split(/([A-Za-z0-9_.@-]+)/).map((part, index) => (index % 2 ? <bdi key={index} dir="ltr">{part}</bdi> : part));
}

export function TaskTicketScreen() {
  const { t } = usePrefs();
  const params = useParams<{ id: string }>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { me } = useOffice();
  const [draft, setDraft] = useState('');
  // An internal note (spec 2026-11-09, 2): the branch's, hidden from the point of sale and the agents.
  const [internalNote, setInternalNote] = useState(true);
  const [closeNote, setCloseNote] = useState('');
  const [reason, setReason] = useState('');
  const [closeMode, setCloseMode] = useState<CloseMode>(null);
  const [closeIccid, setCloseIccid] = useState('');
  const [closeQr, setCloseQr] = useState('');
  const [closeNumber, setCloseNumber] = useState('');
  const [qrOpen, setQrOpen] = useState(false);

  const card = useApiQuery(sharedKeys.task(params.id), () => api.officeTask(params.id));
  const task = card.data?.task ?? null;
  usePageTitle(task ? actionName(t, task.action) : t.taskTicket);
  useCrumbs({ [`/tasks/${encodeURIComponent(params.id)}`]: task ? `${actionName(t, task.action)}${task.msisdn ? ` · ${task.msisdn}` : ''}` : null });
  const events = card.data?.events ?? [];
  // What closing this task hands back: an eSIM request needs the serial and the QR, a number change needs the number.
  const simRules = task?.sim ?? OPEN_SIM;
  const isEsimTask = task?.action === 'esim';
  const takesSim = isEsimTask || (Boolean(task?.esim) && (task?.action === 'activate' || task?.action === 'sim'));
  const takesNumber = task?.action === 'rename';
  const serialOk = closeIccid.trim() === '' ? !isEsimTask : closeIccid.trim().length >= 8 && simFits(simRules, closeIccid.trim());
  const qrOk = !isEsimTask || closeQr !== '';
  const numberOk = !takesNumber || /^05\d{8}$/.test(closeNumber.trim());
  const canClose = serialOk && qrOk && numberOk;
  const closeBody = () => ({
    note: closeNote,
    ...(takesSim && closeIccid.trim() ? { iccid: closeIccid.trim() } : {}),
    ...(takesSim && closeQr ? { qr: closeQr } : {}),
    ...(takesNumber ? { msisdn: closeNumber.trim() } : {}),
  });
  const { run } = useAction({
    setError,
    setNote,
    onDone: async () => {
      setCloseMode(null);
      setCloseNote('');
      setCloseIccid('');
      setCloseQr('');
      setCloseNumber('');
      setReason('');
      await card.reload();
    },
  });

  // The ticket's actions sit beside the title, as in the approved design; complete and reject open their form in the
  // details column.
  const toolbar = task ? (
      <div className="task-toolbar">
        {task.canTake ? (
          <button type="button" className="task-op task-op-take" onClick={() => run(() => api.takeTask(task.id), { note: t.take })}>
            <Hand {...glyph} />
            {t.take}
          </button>
        ) : null}
        {task.canWork ? (
          <>
            {/* Taking only names the handler now (spec 2026-11-09, 2); whoever took it may release it. */}
            {task.assigneeLoginName && task.assigneeLoginName === me?.loginName ? (
              <button type="button" className="task-op task-op-release" onClick={() => run(() => api.releaseTask(task.id), { note: t.release })}>
                <Undo2 {...glyph} />
                {t.release}
              </button>
            ) : null}
            <button
              type="button"
              className={`task-op task-op-complete${closeMode === 'complete' ? ' is-on' : ''}`}
              onClick={() => setCloseMode((mode) => (mode === 'complete' ? null : 'complete'))}
            >
              <Check {...glyph} />
              {t.complete}
            </button>
            <button
              type="button"
              className={`task-op task-op-reject${closeMode === 'reject' ? ' is-on' : ''}`}
              onClick={() => setCloseMode((mode) => (mode === 'reject' ? null : 'reject'))}
            >
              <X {...glyph} />
              {t.reject}
            </button>
          </>
        ) : null}
        {task.canCancel ? (
          <button type="button" className="task-op task-op-cancel" onClick={() => run(() => api.cancelTask(task.id), { note: t.cancelTask })}>
            <Ban {...glyph} />
            {t.cancelTask}
          </button>
        ) : null}
      </div>
  ) : null;

  return (
    <Desk
      title={task ? (
        // Graphite: the operation is the title, with the task's state beside it; the number and package under it.
        <span className="ticket-title">
          <span>{actionName(t, task.action)}</span>
          <Badge variant={taskTone(task.status)} dot>{taskStatus(t, task.status)}</Badge>
        </span>
      ) : t.taskTicket}
      lede={task ? [task.msisdn, task.companyName, task.packageName].filter(Boolean).join(' · ') : ''}
      action={toolbar}
      error={error || card.error}
      note={note}
    >
      {!card.loaded ? (
        <section className="pane">
          <header className="pane-head" />
          <TableSkeleton rows={8} columns={2} />
        </section>
      ) : task ? (
        <section className="pane task-ticket">
          <div className="task-board">
            <aside className="task-rail">
              <Facts variant="list">
                {task.msisdn ? (
                  <Fact label={t.number}>
                    <bdi dir="ltr">{task.msisdn}</bdi>
                  </Fact>
                ) : null}
                <Fact label={t.taskState}>
                  <Badge variant={taskTone(task.status)} dot>
                    {taskStatus(t, task.status)}
                  </Badge>
                </Fact>
                <Fact label={t.simType}>{task.esim ? t.esim : t.physicalSim}</Fact>
                <Fact label={t.simSerial}>{task.iccid ? <bdi dir="ltr">{task.iccid}</bdi> : '—'}</Fact>
                {task.esimQr ? (
                  <Fact label={t.esimQr}><EsimMark src={task.esimQr} label={t.esimQr} onOpen={() => setQrOpen(true)} /></Fact>
                ) : null}
                <Fact label={t.packageName}>{task.packageName || '—'}</Fact>
                <Fact label={t.company}>{task.companyName || '—'}</Fact>
                {task.providerName ? <Fact label={t.provider}>{task.providerName}</Fact> : null}
                {task.posLoginName ? (
                  <Fact label={t.pointOfSale}>
                    <AccountName login={task.posLoginName} />
                  </Fact>
                ) : null}
                <Fact label={t.amount}>
                  <Money value={task.posDelta} />
                </Fact>
                <Fact label={t.movement}>{actionName(t, task.action)}</Fact>
                <Fact label={t.taskSubmitter}>
                  <AccountName login={task.submitterLoginName} />
                </Fact>
                <Fact label={t.taskAssignee}><AccountName login={task.assigneeLoginName} /></Fact>
                <Fact label={t.started}>
                  <bdi dir="ltr">{latinWhen(task.createdAt)}</bdi>
                </Fact>
                {task.note ? (
                  <Fact label={t.taskReason}>
                    {task.note}
                    {task.providerName ? ` · ${task.providerName}` : ''}
                  </Fact>
                ) : null}
              </Facts>

              {closeMode === 'complete' ? (
                <div className="task-close">
                  {takesNumber ? (
                    <label>
                      {t.newNumber}
                      <input value={closeNumber} inputMode="numeric" dir="ltr" onChange={(event) => setCloseNumber(event.target.value)} />
                    </label>
                  ) : null}
                  {takesSim ? (
                    <div className="task-close-sim">
                      <label>
                        {t.simSerial}
                        <input value={closeIccid} inputMode="numeric" dir="ltr" onChange={(event) => setCloseIccid(event.target.value)} />
                        {hasSimRules(simRules) ? <span className="hint">{simHint(t, simRules)}</span> : null}
                      </label>
                      <div className="stack">
                        <span className="hint">{t.qrImage}</span>
                        <QrPicker value={closeQr} onChange={setCloseQr} />
                      </div>
                    </div>
                  ) : null}
                  <div className="task-close-row">
                    <input
                      value={closeNote}
                      onChange={(event) => setCloseNote(event.target.value)}
                      placeholder={t.closeNote}
                      aria-label={t.closeNote}
                    />
                    <button
                      type="button"
                      className="task-op task-op-complete is-on"
                      disabled={!canClose}
                      onClick={() => run(() => api.completeTask(task.id, closeBody()), { note: t.complete })}
                    >
                      <Check {...glyph} />
                      {t.complete}
                    </button>
                  </div>
                </div>
              ) : null}
              {closeMode === 'reject' ? (
                <div className="task-close-row">
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t.reason}
                    aria-label={t.reason}
                  />
                  <button
                    type="button"
                    className="task-op task-op-reject is-on"
                    disabled={!reason.trim()}
                    onClick={() => run(() => api.rejectTask(task.id, reason), { note: t.reject })}
                  >
                    <X {...glyph} />
                    {t.reject}
                  </button>
                </div>
              ) : null}
            </aside>

            <div className="task-thread">
              <header className="task-thread-head">
                <h2 className="task-thread-title">{t.taskTimeline}</h2>
              </header>
              <div className="task-tree-scroll">
                {events.length === 0 ? (
                  <p className="empty">{t.noTaskEvents}</p>
                ) : (
                  <ol className="task-tree">
                    {events.map((event) =>
                      event.kind === 'note' || event.kind === 'result' ? (
                        <li key={event.id} className={`task-tree-node task-tree-${event.kind}`}>
                          <span className="task-tree-dot" aria-hidden="true" />
                          <div className={event.internal ? 'task-tree-card internal' : 'task-tree-card'}>
                            <div className="task-tree-meta">
                              <strong>{event.authorName ? <bdi>{event.authorName}</bdi> : t.taskSystem}</strong>
                              {event.internal ? <Badge variant="warning" dot>{t.internalNote}</Badge> : null}
                              <bdi dir="ltr">{latinWhen(event.at, true)}</bdi>
                            </div>
                            <p>{event.body}</p>
                          </div>
                        </li>
                      ) : (
                        <li key={event.id} className="task-tree-node task-tree-system">
                          <span className="task-tree-dot" aria-hidden="true" />
                          <p className="task-tree-system-line">
                            <span>{isolateLatin(event.body)}</span>
                            <bdi dir="ltr">{latinWhen(event.at, true)}</bdi>
                          </p>
                        </li>
                      ),
                    )}
                  </ol>
                )}
              </div>
              {task.canNote ? (
                <div className="task-tree-compose">
                  <textarea
                    value={draft}
                    rows={3}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t.addTaskNote}
                    aria-label={t.note}
                  />
                  {task.canNoteInternal ? (
                    <label className="check">
                      <input type="checkbox" checked={internalNote} onChange={(event) => setInternalNote(event.target.checked)} />
                      <span>{t.internalNoteToggle}</span>
                    </label>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={!draft.trim()}
                    onClick={() =>
                      run(
                        async () => {
                          const result = await api.addTaskNote(task.id, draft.trim(), internalNote);
                          if (result.ok) setDraft('');
                          return result;
                        },
                        { note: t.addTaskNote },
                      )
                    }
                  >
                    {t.addTaskNote}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="pane">
          <p className="empty">{t.noTasks}</p>
        </section>
      )}
      {task ? <EsimDialog line={qrOpen ? { msisdn: task.msisdn ?? '', iccid: task.iccid, esim: task.esim, esimQr: task.esimQr } : null} onClose={() => setQrOpen(false)} /> : null}
    </Desk>
  );
}
