import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: providers, their ledger entries, reconciliations and the catalog rows made from them. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class ProvidersRepository {
  constructor(private readonly uow: UnitOfWork) {}

  // ── Providers ──────────────────────────────────────────────────────────────────────────────────────────────

  providerByCode(code: string) {
    return this.uow.prisma.provider.findUnique({ where: { code } });
  }

  /** The providers that have a package under a company, each with its packages and their companies. */
  providersWithCatalog() {
    return this.uow.prisma.provider.findMany({
      where: { packages: { some: { companyId: { not: null } } } },
      include: { packages: { include: { company: true }, orderBy: { code: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  providersByName() {
    return this.uow.prisma.provider.findMany({ orderBy: { name: 'asc' } });
  }

  setEsimPrice(code: string, price: number | null) {
    return this.uow.prisma.provider.update({ where: { code }, data: { esimPrice: price } });
  }

  /** The provider's packages that follow its mode for this action. */
  packagesInheriting(providerId: string, action: string) {
    return this.uow.prisma.package.findMany({ where: { providerId, inheritedModes: { has: action } } });
  }

  /** The provider's action modes and the packages that follow them, in one batch. */
  saveModes(code: string, modes: Prisma.ProviderUpdateInput['actionModes'], packages: Array<{ id: string; data: Prisma.PackageUpdateInput }>) {
    return this.uow.prisma.$transaction([
      this.uow.prisma.provider.update({ where: { code }, data: { actionModes: modes } }),
      ...packages.map((pkg) => this.uow.prisma.package.update({
        where: { id: pkg.id },
        data: pkg.data,
      })),
    ]);
  }

  // ── Catalog made from a provider ───────────────────────────────────────────────────────────────────────────

  /** Which of these company codes the office already has. */
  storedCompanyCodes(codes: string[]) {
    return this.uow.prisma.company.findMany({ where: { code: { in: codes } }, select: { code: true } });
  }

  /** The packages already made from these product codes: by their own code, or by this provider's product code. */
  packagesOfProducts(providerId: string, codes: string[]) {
    return this.uow.prisma.package.findMany({
      where: { OR: [{ code: { in: codes } }, { providerId, providerProductCode: { in: codes } }] },
      select: { code: true, providerProductCode: true },
    });
  }

  companyByCode(code: string) {
    return this.uow.prisma.company.findUnique({ where: { code } });
  }

  addCompany(data: Prisma.CompanyCreateInput) {
    return this.uow.prisma.company.create({
      data,
    });
  }

  /** A package that already holds this product code, as its own code or as this provider's product. */
  packageOfProduct(providerId: string, productCode: string) {
    return this.uow.prisma.package.findFirst({
      where: { OR: [{ code: productCode }, { providerId, providerProductCode: productCode }] },
      select: { id: true },
    });
  }

  addPackage(data: Prisma.PackageUncheckedCreateInput) {
    return this.uow.prisma.package.create({
      data,
    });
  }

  // ── Our account with each provider ─────────────────────────────────────────────────────────────────────────

  /** Every payment and settlement, newest first. */
  /** What each provider was paid and settled, summed by the database: one row per provider and kind. */
  entrySums() {
    return this.uow.prisma.providerEntry.groupBy({ by: ['providerId', 'kind'], _sum: { amount: true } });
  }

  /** One provider's payments and settlements, newest first: its ledger page reads the rows. */
  entriesOf(providerId: string) {
    return this.uow.prisma.providerEntry.findMany({ where: { providerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  /** The action and package of every task in these statuses: what open tasks are about to cost. */
  tasksInStatuses(statuses: string[]) {
    return this.uow.prisma.officeTask.findMany({ where: { status: { in: statuses } }, select: { action: true, packageId: true } });
  }

  packagesWithProvider() {
    return this.uow.prisma.package.findMany({ include: { provider: true } });
  }

  addEntry(data: Prisma.ProviderEntryUncheckedCreateInput) {
    return this.uow.prisma.providerEntry.create({ data });
  }

  /** The credit limit, and the alert floor when one was sent. */
  setCredit(code: string, creditLimit: number, alertFloor: number | undefined) {
    return this.uow.prisma.provider.update({ where: { code }, data: { creditLimit, ...(alertFloor !== undefined ? { alertFloor } : {}) } });
  }

  setMatching(code: string, matchSource: string, matchEveryDays: number) {
    return this.uow.prisma.provider.update({ where: { code }, data: { matchSource, matchEveryDays } });
  }

  /** The provider is matched up to this instant, so its overdue notice may be sent again after the next lapse. */
  markMatched(code: string, lastMatchedAt: Date) {
    return this.uow.prisma.provider.update({ where: { code }, data: { lastMatchedAt, matchOverdueNoticeAt: null } });
  }

  // ── Reconciliations ────────────────────────────────────────────────────────────────────────────────────────

  /** Keeps the statement's column choice for the provider's next file. */
  saveStatementMap(db: Db, providerId: string, map: Prisma.ProviderUpdateInput['statementMap']) {
    return db.provider.update({ where: { id: providerId }, data: { statementMap: map } });
  }

  saveReconciliation(db: Db, data: Prisma.ProviderReconciliationUncheckedCreateInput) {
    return db.providerReconciliation.create({
      data,
    });
  }

  /** The provider's last fifty runs, newest first, each with the status of its items. */
  reconciliationsOfProvider(providerId: string) {
    return this.uow.prisma.providerReconciliation.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: { select: { status: true } } },
    });
  }

  reconciliationById(id: string) {
    return this.uow.prisma.providerReconciliation.findUnique({ where: { id }, include: { items: true, provider: true } });
  }

  reconItemById(id: string) {
    return this.uow.prisma.providerReconItem.findUnique({ where: { id } });
  }

  updateReconItem(id: string, data: Prisma.ProviderReconItemUpdateInput) {
    return this.uow.prisma.providerReconItem.update({
      where: { id },
      data,
    });
  }

  // ── Health watch ───────────────────────────────────────────────────────────────────────────────────────────

  /** Each provider's alert floor and the ids of its packages. */
  providerFloorsAndPackages() {
    return this.uow.prisma.provider.findMany({ select: { code: true, alertFloor: true, packages: { select: { id: true } } } });
  }

  /** The package of every task that carries this note and was created since the instant. */
  tasksNotedSince(note: string, since: Date) {
    return this.uow.prisma.officeTask.findMany({
      where: { note, createdAt: { gte: since } },
      select: { packageId: true },
    });
  }

  /** Each provider's matching settings, when it was last matched, and when its overdue notice was sent. */
  providersMatchingState() {
    return this.uow.prisma.provider.findMany({
      select: { code: true, name: true, matchSource: true, matchEveryDays: true, lastMatchedAt: true, matchOverdueNoticeAt: true },
    });
  }

  clearMatchOverdueNotice(code: string) {
    return this.uow.prisma.provider.updateMany({ where: { code }, data: { matchOverdueNoticeAt: null } });
  }

  /** Compare-and-set: only the process that finds no notice time sets it, and its `count` is 1. */
  claimMatchOverdueNotice(code: string, now: Date) {
    return this.uow.prisma.provider.updateMany({ where: { code, matchOverdueNoticeAt: null }, data: { matchOverdueNoticeAt: now } });
  }

  /** Compare-and-set on the stored health: only the process that still finds `stored` writes the change. */
  claimHealthChange(code: string, stored: string, data: Prisma.ProviderUpdateManyMutationInput) {
    return this.uow.prisma.provider.updateMany({
      where: { code, health: stored },
      data,
    });
  }

  /** The branch accounts that are not disabled, with what decides who hears a provider notice. */
  branchAccounts() {
    return this.uow.prisma.user.findMany({
      where: { layer: 'branch', disabledAt: null },
      select: { id: true, isBranchOwner: true, liveGrants: true },
    });
  }
}
