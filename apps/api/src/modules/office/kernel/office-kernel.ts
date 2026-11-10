import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import type { Gate } from '../../shared/cookies';
import { PrismaService } from '../../shared/prisma.service';
import { LineAccess } from '../lines/line-access';
import { NoticeService, type WrittenNotice } from '../notices/notice.service';
import { LayerRoles } from '../roles/layer-roles';
import type { LineTerms } from '../rules/office-rules';
import type { PathNode } from '../rules/user-terms';
import { PriceLadder, type LadderRows } from '../terms/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from './account-tree';
import { ActorResolver, type GrantSource } from './actor-resolver';
import type { Account, Actor, Sale } from './types';
import { UnitOfWork, type Db } from './unit-of-work';

export { nodeOf } from './account-tree';
export { PRICE_COLUMNS, type LadderRows } from '../terms/price-ladder';

export { assertBranch } from '../policy';

/**
 * **Being taken apart** (plan `2026-11-10-office-kernel-split`). Everything it used to do now lives in the
 * collaborators it builds below; each member here only hands the call on, so the services that still inject the
 * kernel keep working until they name the collaborators they use. Do not add to it: inject the collaborator.
 * It is deleted when `architecture.spec` `kernel-use` reaches 0.
 */
@Injectable()
export class OfficeKernel {
  readonly uow: UnitOfWork;
  readonly tree: AccountTree;
  readonly actors: ActorResolver;
  readonly layerRoles: LayerRoles;
  readonly ladder: PriceLadder;
  readonly ledger: WalletLedger;
  readonly lineAccess: LineAccess;

  constructor(
    @Inject(AUTH_STORE) readonly auth: AuthStore,
    @Optional() notice?: NoticeService,
    @Optional() db?: PrismaService,
  ) {
    this.uow = new UnitOfWork(notice, db);
    this.tree = new AccountTree(this.uow);
    this.actors = new ActorResolver(auth, this.uow);
    this.layerRoles = new LayerRoles(this.uow);
    this.ladder = new PriceLadder(this.uow);
    this.ledger = new WalletLedger(this.uow, this.tree, this.ladder);
    this.lineAccess = new LineAccess(this.uow, this.tree);
  }

  // UnitOfWork
  get prismaClient(): PrismaClient | null {
    return this.uow.prismaClient;
  }
  set prismaClient(client: PrismaClient | null) {
    this.uow.prismaClient = client;
  }
  get prisma(): PrismaClient {
    return this.uow.prisma;
  }
  get notice(): NoticeService {
    return this.uow.notice;
  }
  runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.uow.runTx(fn);
  }
  queueNotices(tx: Prisma.TransactionClient, rows: WrittenNotice[]): void {
    this.uow.queueNotices(tx, rows);
  }
  publishQuietly(rows: WrittenNotice[]): Promise<void> {
    return this.uow.publishQuietly(rows);
  }

  // ActorResolver, LayerRoles
  actor(gate: Gate): Promise<Actor> {
    return this.actors.actor(gate);
  }
  grantsFor(stored: GrantSource | null, db?: Db): Promise<string[]> {
    return this.actors.grantsFor(stored, db);
  }
  ensureLayerRoles(): Promise<void> {
    return this.layerRoles.ensureLayerRoles();
  }

  // AccountTree
  accounts(db?: Db): Promise<Account[]> {
    return this.tree.accounts(db);
  }
  visibleAccount(actor: Actor, loginName: string) {
    return this.tree.visibleAccount(actor, loginName);
  }
  chainIds(actorId: string, accounts: Account[]): string[] {
    return this.tree.chainIds(actorId, accounts);
  }
  pathOf(userId: string, accounts: Account[]): PathNode[] {
    return this.tree.pathOf(userId, accounts);
  }

  // WalletLedger
  lockWallets(tx: Prisma.TransactionClient, userIds: string[]): Promise<void> {
    return this.ledger.lockWallets(tx, userIds);
  }
  hold(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, note: string, sale?: Sale) {
    return this.ledger.hold(tx, userId, amount, actorId, note, sale);
  }
  release(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, note: string) {
    return this.ledger.release(tx, userId, amount, actorId, note);
  }
  move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale, reason?: string) {
    return this.ledger.move(tx, userId, amount, actorId, kind, note, sale, reason);
  }
  recordOp(tx: Prisma.TransactionClient, userId: string, actorId: string, kind: string, sale: Sale) {
    return this.ledger.recordOp(tx, userId, actorId, kind, sale);
  }

  // PriceLadder
  termsFor(packageId: string, db?: Db) {
    return this.ladder.termsFor(packageId, db);
  }
  ladderRows(codes: string[], pathIds: string[], db: Db): Promise<LadderRows> {
    return this.ladder.ladderRows(codes, pathIds, db);
  }
  stampWith(terms: LineTerms, path: PathNode[], rows: LadderRows): LineTerms {
    return this.ladder.stampWith(terms, path, rows);
  }

  // LineAccess
  visibleLine(actor: Actor, lineId: string) {
    return this.lineAccess.visibleLine(actor, lineId);
  }
}
