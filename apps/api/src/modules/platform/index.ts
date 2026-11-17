// The public surface of the platform module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { env, isProduction, isTest, wholeEnv } from '../../config';
export { allowedOrigins } from '../../cors';
export { createPrismaClient } from '../../db';
export { DOOR_HOSTS, Layer, expectedLayer } from '../../doors';
export { ERROR_MESSAGES, errorBody } from '../../errors';
export type { ErrorCode } from '../../errors';
export { Activity, NoActivity, answerField, bodyField, param } from './activity.decorator';
export { ActivityInterceptor } from './activity.interceptor';
export { ACTIVITY_ACTIONS, ActivityRecorder } from './activity';
export type { ActivityAction, ActivityDraft } from './activity';
export { ApiFailure, fail } from './api-failure';
export { cookieBase, gateOf, readCookie } from './cookies';
export type { Gate } from './cookies';
export { csvCell, csvDocument } from './csv';
export { dayRange } from './dates';
export { AwaitsFirstAnswer, NotDuplicateGuarded, REPLAY_HEADER, SecretAnswer } from './duplicate-guard.interceptor';
export { assertCanSealEsimCode, assertStoredSealed, esimCodeOrFail, storableEsimCode } from './esim-code';
export { parseInput } from './input';
export { errorCode, logger, reason } from './log';
export { NOTICE_WRITER } from './notices';
export type { FundNoticePayload, MatchOverduePayload, NoticeActor, NoticeDraft, NoticeKind, NoticeView, NoticeWriter, ProviderNoticePayload, SystemAlertKind, TaskNoticePayload, TransferNoticePayload, WalletNoticePayload, WrittenNotice } from './notices';
export { BALANCES_PAGE, FEED_PAGE, LINES_PAGE, LIST_CAP, NEWEST_FIRST, NOTICES_PAGE, TASKS_PAGE, TOTAL_CAP, after, capList, cappedTotal, countUpTo, cursorPosition, encodeKeyCursor, keyCursor, keyPage, page } from './paging';
export type { Page, Total } from './paging';
export { PlatformModule } from './platform.module';
export { isUniqueViolation } from './prisma-errors';
export { PrismaService } from './prisma.service';
export { RESOURCE_CONTROLLER_PREFIXES } from './route-prefixes';
export { ACTIVITY_RETENTION_DAYS, ENDED_SESSION_RETENTION_DAYS, LINE_SNAPSHOT_RETENTION_DAYS, PUBLISHED_OUTBOX_RETENTION_DAYS, READ_NOTICE_RETENTION_DAYS, RETENTION_BATCH_ROWS, UNREAD_NOTICE_RETENTION_DAYS, daysBefore, inBatches } from './retention';
export { MAX_AGOROT, PeriodQuery, agorot, code, dataUrl, id, isOn, loginName, optionalAgorot, optionalText, positiveAgorot, providerHint, queryCursor, queryDay, queryFlag, queryOneOf, queryText, text } from './schemas';
export { normalizeArabic } from './normalize-arabic';
export { asciiDigits, searchTerms } from './search';
export type { SearchTerms } from './search';
export { isSealed, open, seal, secretsKey } from './secret-box';
export { BRANCH_TASK_NOTE, HANDLER_FROZEN_NOTE, PROVIDER_DISPATCH_NOTE, PROVIDER_EXCEPTION_NOTES, PROVIDER_FAILED_NOTE, PROVIDER_RELEASED_NOTE, PROVIDER_UNKNOWN_NOTE, SYSTEM_SENDER_NAME } from './stored-text';
export { UnitOfWork, transaction } from './unit-of-work';
export type { Db } from './unit-of-work';
export { LAYER_ORDER } from './values';
export { ApiZodBody } from '../../openapi/body';
export { ApiZodQuery } from '../../openapi/query';
export { ApiErrorResponse } from '../../openapi/responses';
export { ServerErrorRecorder } from './server-errors';
export type { ServerErrorDraft } from './server-errors';
