import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork, type Db } from '../../platform';

/**
 * The database as this domain reads and writes it: packages, their add-ons, renewal and switch targets, and sell prices. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class PackagesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  packageByCode(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({ where: { code } });
  }

  providerById(id: string) {
    return this.uow.prisma.provider.findUnique({ where: { id } });
  }

  /** Writes a package's operation flags and modes. */
  saveModes(code: string, data: Prisma.PostpaidPackageUpdateInput) {
    return this.uow.prisma.postpaidPackage.update({ where: { code }, data });
  }

  /** A package with everything its sheet shows: provider, company, line statuses, renewal and switch targets. */
  packageSheet(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({
      where: { code },
      include: {
        provider: true,
        // The company's code, name and eSIM price: the sheet sends no picture (speed plan PF.7).
        company: { select: { code: true, name: true, esimPrice: true } },
        lines: { select: { status: true } },
        renewals: { include: { target: { select: { code: true } } } },
        switches: { include: { target: { select: { code: true } } } },
        durations: { orderBy: [{ position: 'asc' }, { unit: 'asc' }, { count: 'asc' }] },
      },
    });
  }

  /** Writes fields of one package: its details, or its price chain. */
  savePackage(id: string, data: Prisma.PostpaidPackageUpdateInput) {
    return this.uow.prisma.postpaidPackage.update({ where: { id }, data });
  }

  durationById(id: string) {
    return this.uow.prisma.postpaidPackageDuration.findUnique({ where: { id } });
  }

  removeDuration(id: string) {
    return this.uow.prisma.postpaidPackageDuration.delete({ where: { id } });
  }

  /** A package with its extra operations in their order. */
  packageWithAddons(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({ where: { code }, include: { addons: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } });
  }

  addonById(id: string) {
    return this.uow.prisma.postpaidPackageAddon.findUnique({ where: { id } });
  }

  saveAddon(id: string, data: Prisma.PostpaidPackageAddonUpdateInput) {
    return this.uow.prisma.postpaidPackageAddon.update({ where: { id }, data });
  }

  /** How many extra operations a package has; a new one takes this as its position. */
  addonCount(packageId: string) {
    return this.uow.prisma.postpaidPackageAddon.count({ where: { packageId } });
  }

  addAddon(data: Prisma.PostpaidPackageAddonUncheckedCreateInput) {
    return this.uow.prisma.postpaidPackageAddon.create({ data });
  }

  removeAddon(id: string) {
    return this.uow.prisma.postpaidPackageAddon.delete({ where: { id } });
  }

  /** A package with the company and provider its targets must share. */
  packageWithCompany(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({ where: { code }, include: { company: { select: { code: true } }, provider: true } });
  }

  /** The packages named as targets, each with its company's code and its provider. */
  packagesByCodes(codes: string[]) {
    return this.uow.prisma.postpaidPackage.findMany({
      where: { code: { in: codes } },
      include: { company: { select: { code: true } }, provider: true },
    });
  }

  clearRenewalTargets(db: Db, packageId: string) {
    return db.postpaidPackageRenewal.deleteMany({ where: { packageId } });
  }

  addRenewalTargets(db: Db, data: Prisma.PostpaidPackageRenewalCreateManyInput[]) {
    return db.postpaidPackageRenewal.createMany({ data });
  }

  clearSwitchTargets(db: Db, packageId: string) {
    return db.postpaidPackageSwitch.deleteMany({ where: { packageId } });
  }

  addSwitchTargets(db: Db, data: Prisma.PostpaidPackageSwitchCreateManyInput[]) {
    return db.postpaidPackageSwitch.createMany({ data });
  }
}
