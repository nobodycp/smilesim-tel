import { Injectable } from '@nestjs/common';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: accounts, their roles and what must be empty before one is removed. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class AccountsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every account as the users list shows it, by login name. */
  listedAccounts() {
    return this.uow.prisma.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true, disabledAt: true, isBranchOwner: true, role: { select: { name: true, staff: true } } },
      orderBy: { loginName: 'asc' },
    });
  }

  walletsOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } } });
  }

  roleById(id: string) {
    return this.uow.prisma.role.findUnique({ where: { id } });
  }

  branchOwner() {
    return this.uow.prisma.user.findFirst({ where: { isBranchOwner: true } });
  }

  branchOwnerId() {
    return this.uow.prisma.user.findFirst({ where: { isBranchOwner: true }, select: { id: true } });
  }

  accountByLogin(loginName: string) {
    return this.uow.prisma.user.findUnique({ where: { loginName } });
  }

  accountWithRoleByLogin(loginName: string) {
    return this.uow.prisma.user.findUnique({ where: { loginName }, include: { role: true } });
  }

  /** The login name of one account, for showing who its parent is. */
  loginOf(id: string) {
    return this.uow.prisma.user.findUnique({ where: { id }, select: { loginName: true } });
  }

  /** Opens a branch employee under the owner, with its role and an empty wallet. */
  openEmployee(input: { loginName: string; nickname: string; passwordHash: string; parentId: string; roleId: string }) {
    return this.uow.prisma.user.create({
      data: {
        loginName: input.loginName,
        nickname: input.nickname,
        passwordHash: input.passwordHash,
        mustChangePassword: true,
        layer: 'branch',
        parentId: input.parentId,
        roleId: input.roleId,
        wallet: { create: {} },
      },
    });
  }

  /** Opens an account of a layer below the branch, with an empty wallet. */
  openAccount(input: { loginName: string; nickname: string; passwordHash: string; layer: string; parentId: string }) {
    return this.uow.prisma.user.create({
      data: {
        loginName: input.loginName,
        nickname: input.nickname,
        passwordHash: input.passwordHash,
        mustChangePassword: true,
        layer: input.layer,
        parentId: input.parentId,
        wallet: { create: {} },
      },
    });
  }

  /** Stores a password someone else chose: the account must change it at its next sign-in. */
  resetPassword(id: string, passwordHash: string) {
    return this.uow.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
  }

  /** The role every account of a layer holds. */
  layerRole(layer: string) {
    return this.uow.prisma.role.findUnique({ where: { layer } });
  }

  jobRoles() {
    return this.uow.prisma.role.findMany({ where: { kind: 'job' }, orderBy: { name: 'asc' } });
  }

  /** Which of these ids are job roles. */
  jobRoleIdsAmong(ids: string[]) {
    return this.uow.prisma.role.findMany({ where: { id: { in: ids }, kind: 'job' }, select: { id: true } });
  }

  /** The roles an account holds on top of its own, each with the role itself. */
  extraRolesOf(userId: string) {
    return this.uow.prisma.userRole.findMany({ where: { userId }, include: { role: true } });
  }

  saveGrants(db: Db, id: string, input: { extraGrants: string; deniedGrants: string; roleId: string | null }) {
    return db.user.update({
      where: { id },
      data: { extraGrants: input.extraGrants, deniedGrants: input.deniedGrants, roleId: input.roleId },
    });
  }

  clearExtraRoles(db: Db, userId: string) {
    return db.userRole.deleteMany({ where: { userId } });
  }

  addExtraRoles(db: Db, userId: string, roleIds: string[]) {
    return db.userRole.createMany({ data: roleIds.map((id) => ({ userId, roleId: id })) });
  }

  /** Freezes an account at a moment, or unfreezes it with `null`. */
  setFrozenAt(id: string, disabledAt: Date | null) {
    return this.uow.prisma.user.update({ where: { id }, data: { disabledAt } });
  }

  openTasksHandledBy(assigneeId: string) {
    return this.uow.prisma.officeTask.findMany({ where: { assigneeId, status: 'working' }, select: { id: true, log: true } });
  }

  /** Hands a task back to the pool, only if this account is still working on it. */
  releaseTask(id: string, assigneeId: string, log: string) {
    return this.uow.prisma.officeTask.updateMany({
      where: { id, assigneeId, status: 'working' },
      data: { assigneeId: null, log },
    });
  }

  childCount(db: Db, id: string) {
    return db.user.count({ where: { parentId: id } });
  }

  lineCount(db: Db, id: string) {
    return db.line.count({ where: { posId: id } });
  }

  /** Tasks the account sent, was the point of sale of, or handled. */
  taskCount(db: Db, id: string) {
    return db.officeTask.count({ where: { OR: [{ submitterId: id }, { posId: id }, { assigneeId: id }] } });
  }

  /** Wallet entries on the account's wallet or made by it. */
  walletEntryCount(db: Db, id: string) {
    return db.walletEntry.count({ where: { OR: [{ userId: id }, { actorId: id }] } });
  }

  removeSessions(db: Db, userId: string) {
    return db.session.deleteMany({ where: { userId } });
  }

  removeWallet(db: Db, userId: string) {
    return db.wallet.deleteMany({ where: { userId } });
  }

  removePackages(db: Db, userId: string) {
    return db.userPackage.deleteMany({ where: { userId } });
  }

  removeSellPrices(db: Db, ownerId: string) {
    return db.sellPrice.deleteMany({ where: { ownerId } });
  }

  removeAccount(db: Db, id: string) {
    return db.user.delete({ where: { id } });
  }

  /** Records that an operator entered an account. */
  logEntry(input: { actorId: string; targetLoginName: string; ip: string }) {
    return this.uow.prisma.accessLog.create({ data: { actorId: input.actorId, targetLoginName: input.targetLoginName, ip: input.ip } });
  }
}
