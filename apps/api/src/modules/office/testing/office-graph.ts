import type { Provider } from '@nestjs/common';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { AuthStore } from '../../auth/auth.store';
import type { PrismaService } from '../../shared/prisma.service';
import { AccountTree } from '../kernel/account-tree';
import { ActorResolver } from '../kernel/actor-resolver';
import { UnitOfWork } from '../kernel/unit-of-work';
import { LineAccess } from '../lines/line-access';
import type { NoticeService } from '../notices/notice.service';
import { LayerRoles } from '../roles/layer-roles';
import { PriceLadder } from '../terms/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';

/**
 * Test-only: the collaborators every office service is built from, wired by hand as Nest wires them in the app.
 * A spec builds a service with `new XService(graph.uow, graph.tree, …)` and swaps in its in-memory tables through
 * `graph.prismaClient`.
 */
export class OfficeGraph {
  readonly uow: UnitOfWork;
  readonly tree: AccountTree;
  readonly actors: ActorResolver;
  readonly layerRoles: LayerRoles;
  readonly ladder: PriceLadder;
  readonly ledger: WalletLedger;
  readonly lineAccess: LineAccess;

  constructor(readonly auth: AuthStore, notice?: NoticeService, db?: PrismaService) {
    this.uow = new UnitOfWork(notice, db);
    this.tree = new AccountTree(this.uow);
    this.actors = new ActorResolver(auth, this.uow);
    this.layerRoles = new LayerRoles(this.uow);
    this.ladder = new PriceLadder(this.uow);
    this.ledger = new WalletLedger(this.uow, this.tree, this.ladder);
    this.lineAccess = new LineAccess(this.uow, this.tree);
  }

  /** The client the services read through; a spec assigns its in-memory tables here. */
  get prismaClient(): PrismaClient | null {
    return this.uow.prismaClient;
  }

  set prismaClient(client: PrismaClient | null) {
    this.uow.prismaClient = client;
  }

  /** This graph's instances as providers, for a spec app that serves the routes over them. */
  providers(): Provider[] {
    return [
      { provide: UnitOfWork, useValue: this.uow },
      { provide: AccountTree, useValue: this.tree },
      { provide: ActorResolver, useValue: this.actors },
      { provide: LayerRoles, useValue: this.layerRoles },
      { provide: PriceLadder, useValue: this.ladder },
      { provide: WalletLedger, useValue: this.ledger },
      { provide: LineAccess, useValue: this.lineAccess },
    ];
  }
}
