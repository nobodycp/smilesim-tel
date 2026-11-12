# Provider operation screens: the waiting label, the decisions and the second approval

Date: 2026-11-12. Slice S.10 of plan `2026-11-10-activation-settlement.md` (O6). Builds on ADR 0019: D6 (what
an operation allows on its task), D12 (who is named), D15 (decisions by people), D16 (the exception), D17 (eSIM
codes). It changes no rule of the settlement or of the decisions: it shows what the API already decides.

No sale records a provider operation yet (S.11), so nothing here is seen in the office until then. Every screen
is exercised against scripted answers (Playwright) and the reads against PostgreSQL over HTTP.

## 1. What the API tells a screen

The screens offer nothing the routes would refuse, and are told so by the API. Hiding a button is never the
protection: every route keeps its own gate.

| Read | Who | What |
|---|---|---|
| `GET /office/tasks` rows | every reader of the task | `operationPhase` (null for a manual task); `canTake`, `canWork`, `canCancel` now also follow D6 |
| `GET /office/tasks/:id` | every reader of the task | `operation: { phase, reason, decisions } \| null`, `hold`; the same three flags follow D6 |
| `GET /office/tasks/:id/provider-decision` (new) | the branch owner or a branch account holding `accounting`, in a session of its own | where the operation stands, the amount held, what this account may do now, what the form must ask for, the open proposal, the record |
| `GET /office/provider-decisions?waiting=&cursor=` (new) | the same | the operations of open tasks that wait for a person, a page at a time in the list contract (`{ items, nextCursor, total }` plus `totals`), newest first |

- `phase`: `requested`, `pending`, `unknown`, `unapplied`, `exception`, `applied`, `failed` (`phaseOf`).
- `reason` (why an exception could not be applied) is answered to branch accounts only, as the provider's name is.
- `decisions` is true for an account that may read the decision view. It is false for an entered session.
- `hold`: `none`, `held`, `captured`, `released`, told from the task (`holdOf`).
- What an account may do (`decisions`, `canApprove`, `canRefuse`, `blocked`) is asked of `decisionStep`
  (`decisionChoices`), so a screen offers exactly what the two write routes accept.
- No read carries an eSIM code: the decision record has no column for one (`suppliedEsimCode` only), and the two
  new reads do not select the operation's result.
- Reads write nothing: no activity event, no notice.

## 2. The task ticket

A task with an operation shows a panel at the top of its details column:

- the phase, as a badge, with one sentence that says what it means and what can be done;
- the money: held, settled, or given back;
- for the branch, why an exception could not be applied.

| Phase | Label (ar) | Tone |
|---|---|---|
| `requested` | بانتظار إرسال الطلب | info |
| `pending` | جارٍ التنفيذ لدى المزوّد | info |
| `unknown` | النتيجة غير مؤكدة | warning |
| `unapplied` | نجح عند المزوّد، قيد التطبيق | info |
| `applied` | تم التفعيل | success |
| `failed` | فشل عند المزوّد | danger |
| `exception` | نجح عند المزوّد وتعذّرت التسوية | violet |

Complete, reject, take and cancel are shown only when the API's flags say so (D6). A manual task (no operation)
shows no panel and behaves as before.

## 3. Decisions

An account for which `operation.decisions` is true reads the decision view under the panel:

- **The open proposal**: the decision, who proposed it, the evidence (kind, reference, note), when, and what
  approving does to the money. «موافقة» and «رفض الاقتراح» when the view allows them, each behind a confirmation
  that repeats the effect. When the view does not: why (it is your proposal; you submitted this task; the
  operation moved on and it can only be refused).
- **The decisions this account may state**, each a button that opens the form.
- **The record** so far: every step, who, on what evidence, when. Never a code.

The form, in a dialog:

| Field | Shown | Required |
|---|---|---|
| Kind of evidence | always | yes |
| Provider reference | always | for *confirm success* |
| Note | always | 20 characters, counted as the API counts them |
| Number the provider activated | *confirm success*, *apply corrected* | when the view says `needs.number` |
| Serial the provider activated | *confirm success*, *apply corrected* | no |
| eSIM activation code | only when the view says `needs.esimCode` | yes |

The dialog's lede says what the decision does to the line and to the held amount, and whether it takes effect at
once or is a proposal for a second account. The checks in the form are for the person's convenience; the API
judges every request.

## 4. The queue

`/tasks/decisions`, linked from the tasks page for the accounts that may decide. Two tabs: proposals that wait
for a second account, and operations nobody has decided on yet. Each row: the operation and its phase, the
number, the package, the point of sale, the submitter, the amount held, since when; for a proposal the decision,
its proposer, its evidence, and the effect of approving. Approve and refuse are offered where the API allows
them; every row opens its task. The list is whatever the API answers: nothing is filtered in the browser.

**Paged, with no ceiling** (final review of S.10; a first version served the oldest 200 and stopped):

- The list contract of every other list: `?cursor=`, fifty rows a page, `nextCursor`, `total`.
- **Order:** newest first by the time the operation was recorded, then by id. That time never changes, so a row
  keeps its place while the list is walked: a walk meets every operation that is still waiting once, and none
  twice, even while others are decided or proposed meanwhile. A new operation appears at the top.
- **`waiting=approval`** keeps the operations whose last decision step is a proposal, **`waiting=decision`** the
  others. The tab is in the address.
- **Counts:** `totals: { approval, decision }` are counted in the database on every page, and `total` is the
  count of the part asked for. The tabs and the link's badge show these, never the size of a page.
- The gate and what each row offers this account are applied on every page.

## 5. After a write

- The task, the decision view, the tasks list and the queue are asked again.
- The form's state is dropped when the dialog closes, on success or not.
- A `409` (the operation moved on, a proposal is open, there is none) is shown in words, the dialog closes and
  the data is asked again, so nothing stale offers a decision that is no longer there.
- A button cannot be pressed twice while its request runs.
- A network failure says so in the dialog; nothing is sent again by itself, and nothing claims success.

## 6. eSIM codes (D17)

- The code typed into the form lives in the dialog's own state only: not in the address, not in local or session
  storage, not in the query cache, not in the console. It is cleared when the dialog closes or the page is left.
- The task's own code is shown as before, in the ticket's detail, to the accounts the API hands it to; the
  ticket's read is not kept in the cache once the page closes. The decision view and the queue never have one.
- Moving from one task to another shows nothing of the first.

## 7. Layout

The existing system: tokens, `Badge`, `Button`, `Dialog`, `Facts`, `Desk`. No new primitive. Checked at phone,
tablet and desktop widths, in Arabic (RTL) and English (LTR), light and dark; Hebrew copy is complete.

## 8. Specs

- API over HTTP on PostgreSQL (`provider-decisions.db.spec.ts`): each phase in the detail and the list with the
  flags D6 allows; who reads the decision view and the queue; what each account may do; a stale proposal; what
  the form must ask for; no code in any read; reads write nothing.
- Playwright (`provider-operation.spec.ts`): every phase; a manual task unchanged; the four decisions; approve
  and refuse; what each kind of account sees; a stale proposal; `esim-code-missing`; the code's privacy; the
  screen after a decision; a `409`; a lost connection; phone and desktop, ar and en, light and dark.
