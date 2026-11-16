'use client';

import { Ban, Check, Hand, Undo2, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, Pane, actionName, latinWhen, taskStatus } from '../../../components/desk';
import { EsimDialog, EsimMark, QrPicker } from '../../../components/esim-qr';
import { TableSkeleton } from '../../../components/loading';
import { Badge } from '../../../components/ui/badge';
import { useDesk } from '../../../lib/desk-session';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { cn } from '../../../lib/cn';
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
import { ProviderOperationPanel } from '../components/provider-operation-panel';

const glyph = { size: 14, strokeWidth: 1.95, 'aria-hidden': true as const };

type CloseMode = null | 'complete' | 'reject';

/*
 * The ticket (Tailwind migration T4.6, ADR 0022), ported from desk/tasks.css and graphite.css "Task ticket" in their
 * cascade order:
 * - the card: `Pane` with no fill, ring or shadow, a flex column that fills the desk (it grows, where a list's card
 *   keeps its height), clipped, and the `task-ticket` inline-size container the narrow rules below read;
 * - the board: two rows-high grid 14px apart, the details (16–20rem) before the log; from 900px the log first and the
 *   details (18–22rem) after it. In a ticket 36rem or narrower it is a scrolling column: the details above the log, at
 *   most 40% of the board, and the log at its full length (at least 12rem) scrolling only sideways;
 * - the details and the log: each a column on `--rd-surface` with 6px corners and a 1px inset `--rd-line` edge, never
 *   wider than the board; the details 12px apart with 14px / 16px / 16px padding, scrolling;
 * - the head's actions: a wrapping row 8px apart (the page head's rule over tasks.css's);
 * - the close forms: a column 10px apart; the SIM pair in columns of at least 16rem, 12px apart; a close row a column
 *   8px apart, its button at the reading start. Fields and labels are the pane's (34px, 13px on `--rd-surface`; 44px at
 *   720px and under), hints 12px `--rd-muted`;
 * - the log: its head 12px / 16px above (0.95rem bold ink title), the tree scrolling (12px / 16px / 8px padding, its
 *   overscroll kept), each node a 1.25rem rail and the content 12px apart, 14px under it (none under the last), a 2px
 *   `--rd-line` thread from 0.95rem down the rail (not after the last), the node's mark a 9px diamond (2px corners,
 *   `--rd-muted`, a 3px `--rd-surface` halo, 0.4rem down), a system line's 0.45rem `--rd-faint` (0.5rem down);
 * - a note: a 1px `--rd-line` box with a 1px inset `--rd-line` edge, 6px corners, 12px / 14px padding on
 *   `--rd-surface-2` (an internal one: a 3px `--rd-warning` edge at the reading start on `--rd-warning-soft`); its meta a
 *   wrapping row 4px / 10px apart, 6px above the text, the author 13px bold ink, every `bdi` in it 12px semibold
 *   `--rd-muted` tabular; its text 15px ink at 1.55, kept as typed;
 * - a system line: a wrapping row 6px / 12px apart, 13px semibold `--rd-ink-2` at 1.5, 2px above and below, every
 *   `bdi` in it 12px `--rd-muted` tabular;
 * - the compose bar: the field and the button 8px apart on their last line, 10px / 16px / 14px padding over a 1px
 *   `--rd-line` rule on `--rd-surface`; the field 68px high with no top or bottom padding; the internal toggle the
 *   pane's check row (at least 36px, 44px at 720px and under; 11px semibold `--rd-muted`, 4px apart) at the top; in a
 *   ticket 28rem or narrower one column, the button at the reading start.
 * Container widths are given as `px` + 1 (`@max-[577px]` = 36rem and under), as the viewport's touch width (`max-touch:`, under 721px) is.
 */
const TICKET = '@container/task-ticket bg-transparent inset-ring-0 [.desk>&]:flex-1';
const BOARD = cn(
  'grid min-h-0 w-full flex-1 grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] grid-rows-1 gap-3.5',
  'lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]',
  '@max-[577px]/task-ticket:flex @max-[577px]/task-ticket:flex-col @max-[577px]/task-ticket:overflow-y-auto',
);
const SIDE = 'rounded-sm bg-surface inset-ring inset-ring-line';
const RAIL = cn(
  SIDE,
  'flex min-h-0 min-w-0 flex-col gap-3 overflow-auto px-4 pt-3.5 pb-4 lg:order-2',
  '@max-[577px]/task-ticket:max-h-[40%] @max-[577px]/task-ticket:flex-none',
);
const THREAD = cn(
  SIDE,
  'flex min-h-0 w-full min-w-0 flex-col overflow-hidden lg:order-1',
  '@max-[577px]/task-ticket:min-h-48 @max-[577px]/task-ticket:flex-[1_0_auto]',
);
const TREE_SCROLL = cn(
  'min-h-0 flex-1 overflow-auto overscroll-contain px-4 pt-3 pb-2',
  '@max-[577px]/task-ticket:overflow-x-auto @max-[577px]/task-ticket:overflow-y-hidden @max-[577px]/task-ticket:overscroll-auto',
);
const NODE = cn(
  'relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-3.5 last:pb-0',
  "not-last:before:absolute not-last:before:start-2 not-last:before:top-3.75 not-last:before:bottom-0 not-last:before:w-0.5 not-last:before:bg-line not-last:before:content-['']",
);
const DOT = 'relative z-raised mx-auto rotate-45 rounded-3xs ring-3 ring-surface';
const HINT = 'm-0 text-sm text-muted';
const FIELD = 'min-w-0 text-md';
const CLOSE_ROW = 'grid gap-2';
const EMPTY = 'm-0 block p-3.5 text-md text-muted';

/** Timeline lines come composed from the server; login names inside them keep their own direction. */
function isolateLatin(text: string) {
  return text.split(/([A-Za-z0-9_.@-]+)/).map((part, index) => (index % 2 ? <bdi key={index} dir="ltr">{part}</bdi> : part));
}

export function TaskTicketScreen() {
  const { t } = usePrefs();
  const params = useParams<{ id: string }>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { me } = useDesk();
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

  // `fresh`: the answer may carry an eSIM code, so it is not kept in the shared cache once this page closes.
  const card = useApiQuery(sharedKeys.task(params.id), () => api.task(params.id), { fresh: true });
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
      <div className="m-0 flex flex-wrap items-center gap-2 border-0 p-0" data-testid="task-toolbar">
        {task.canTake ? (
          <Button type="button" onClick={() => run(() => api.takeTask(task.id), { note: t.take })}>
            <Hand {...glyph} />
            {t.take}
          </Button>
        ) : null}
        {task.canWork ? (
          <>
            {/* Taking only names the handler now (spec 2026-11-09, 2); whoever took it may release it. */}
            {task.assigneeLoginName && task.assigneeLoginName === me?.loginName ? (
              <Button type="button" variant="secondary" onClick={() => run(() => api.releaseTask(task.id), { note: t.release })}>
                <Undo2 {...glyph} />
                {t.release}
              </Button>
            ) : null}
            {/* Complete and reject open their form in the details column; the open one is pressed. */}
            <Button
              type="button"
              variant={closeMode === 'complete' ? 'primary' : 'secondary'}
              aria-pressed={closeMode === 'complete'}
              onClick={() => setCloseMode((mode) => (mode === 'complete' ? null : 'complete'))}
            >
              <Check {...glyph} />
              {t.complete}
            </Button>
            <Button
              type="button"
              variant="danger"
              aria-pressed={closeMode === 'reject'}
              onClick={() => setCloseMode((mode) => (mode === 'reject' ? null : 'reject'))}
            >
              <X {...glyph} />
              {t.reject}
            </Button>
          </>
        ) : null}
        {task.canCancel ? (
          <Button type="button" variant="danger" onClick={() => run(() => api.cancelTask(task.id), { note: t.cancelTask })}>
            <Ban {...glyph} />
            {t.cancelTask}
          </Button>
        ) : null}
      </div>
  ) : null;

  return (
    <Desk
      title={task ? (
        // Graphite: the operation is the title, with the task's state beside it; the number and package under it.
        <span className="inline-flex flex-wrap items-center gap-3">
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
        <Pane>
          <header className="flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5" />
          <TableSkeleton rows={8} columns={2} />
        </Pane>
      ) : task ? (
        <Pane className={TICKET}>
          <div className={BOARD}>
            <aside className={RAIL} data-testid="task-rail">
              {/* A task that went to a provider says where that stands, above its details; a manual task has none. */}
              <ProviderOperationPanel key={task.id} task={task} onChanged={card.reload} say={({ error: failed = '', note: said = '' }) => { setError(failed); setNote(said); }} />
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
                <div className="grid gap-2.5">
                  {takesNumber ? (
                    <Label tone="pane">
                      {t.newNumber}
                      <Input surface="surface" className={FIELD} value={closeNumber} inputMode="numeric" dir="ltr" onChange={(event) => setCloseNumber(event.target.value)} />
                    </Label>
                  ) : null}
                  {takesSim ? (
                    <div className="grid grid-cols-fit-card items-start gap-3">
                      <Label tone="pane">
                        {t.simSerial}
                        <Input surface="surface" className={FIELD} value={closeIccid} inputMode="numeric" dir="ltr" onChange={(event) => setCloseIccid(event.target.value)} />
                        {hasSimRules(simRules) ? <span className={HINT}>{simHint(t, simRules)}</span> : null}
                      </Label>
                      {/* A column 12px apart. It keeps the `stack` class only as the handle of frame.css's
                          `.canvas-inner.wide:has(.stack)` sizing rule, which reads it while this form is open. */}
                      <div className="stack grid min-w-0 max-w-full content-start gap-3 *:min-w-0">
                        <span className={HINT}>{t.qrImage}</span>
                        <QrPicker value={closeQr} onChange={setCloseQr} />
                      </div>
                    </div>
                  ) : null}
                  <div className={CLOSE_ROW} data-testid="task-close-row">
                    <Input
                      surface="surface"
                      className={FIELD}
                      value={closeNote}
                      onChange={(event) => setCloseNote(event.target.value)}
                      placeholder={t.closeNote}
                      aria-label={t.closeNote}
                    />
                    <Button
                      type="button"
                      className="justify-self-start"
                      disabled={!canClose}
                      onClick={() => run(() => api.completeTask(task.id, closeBody()), { note: t.complete })}
                    >
                      <Check {...glyph} />
                      {t.complete}
                    </Button>
                  </div>
                </div>
              ) : null}
              {closeMode === 'reject' ? (
                <div className={CLOSE_ROW} data-testid="task-close-row">
                  <Input
                    surface="surface"
                    className={FIELD}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t.reason}
                    aria-label={t.reason}
                  />
                  <Button
                    type="button"
                    variant="danger"
                    className="justify-self-start"
                    disabled={!reason.trim()}
                    onClick={() => run(() => api.rejectTask(task.id, reason), { note: t.reject })}
                  >
                    <X {...glyph} />
                    {t.reject}
                  </Button>
                </div>
              ) : null}
            </aside>

            <div className={THREAD}>
              <header className="flex-none px-4 pt-3 pb-0">
                <h2 className="m-0 text-lg font-bold text-ink">{t.taskTimeline}</h2>
              </header>
              <div className={TREE_SCROLL}>
                {events.length === 0 ? (
                  <p className={EMPTY}>{t.noTaskEvents}</p>
                ) : (
                  <ol className="m-0 grid w-full list-none gap-0 p-0">
                    {events.map((event) =>
                      event.kind === 'note' || event.kind === 'result' ? (
                        <li key={event.id} className={NODE}>
                          <span className={cn(DOT, 'mt-1.5 size-2.25 bg-muted')} aria-hidden="true" />
                          <div
                            className={cn(
                              'min-w-0 rounded-sm border border-line bg-surface-2 px-3.5 py-3 inset-ring inset-ring-line',
                              event.internal && 'border-s-3 border-s-warning bg-warning-soft',
                            )}
                            data-testid={event.internal ? 'task-note-internal' : 'task-note'}
                          >
                            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1 [&_bdi]:text-sm [&_bdi]:font-semibold [&_bdi]:text-muted [&_bdi]:tabular-nums">
                              <strong className="text-md font-bold text-ink">{event.authorName ? <bdi>{event.authorName}</bdi> : t.taskSystem}</strong>
                              {event.internal ? <Badge variant="warning" dot>{t.internalNote}</Badge> : null}
                              <bdi dir="ltr">{latinWhen(event.at, true)}</bdi>
                            </div>
                            <p className="m-0 text-lg leading-1-55 whitespace-pre-wrap text-ink">{event.body}</p>
                          </div>
                        </li>
                      ) : (
                        <li key={event.id} className={NODE}>
                          <span className={cn(DOT, 'mt-2 size-1.75 bg-faint')} aria-hidden="true" />
                          <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 py-0.5 text-md leading-1-5 font-semibold text-ink-2 [&_bdi]:text-sm [&_bdi]:text-muted [&_bdi]:tabular-nums">
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
                <div
                  className="grid flex-none grid-cols-title-end items-end gap-2 border-t border-line bg-surface px-4 pt-2.5 pb-3.5 @max-[449px]/task-ticket:grid-cols-1"
                  data-testid="task-compose"
                >
                  <Textarea
                    className="h-10.5 min-h-17 py-0"
                    value={draft}
                    rows={3}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t.addTaskNote}
                    aria-label={t.note}
                  />
                  {task.canNoteInternal ? (
                    <Label tone="pane" className="m-0 flex min-h-9 cursor-pointer items-center self-start max-touch:min-h-11">
                      <Checkbox checked={internalNote} onCheckedChange={(next) => setInternalNote(next === true)} />
                      <span>{t.internalNoteToggle}</span>
                    </Label>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="@max-[449px]/task-ticket:justify-self-start"
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
        </Pane>
      ) : (
        <Pane>
          <p className={EMPTY}>{t.noTasks}</p>
        </Pane>
      )}
      {task ? <EsimDialog line={qrOpen ? { msisdn: task.msisdn ?? '', iccid: task.iccid, esim: task.esim, esimQr: task.esimQr } : null} onClose={() => setQrOpen(false)} /> : null}
    </Desk>
  );
}
