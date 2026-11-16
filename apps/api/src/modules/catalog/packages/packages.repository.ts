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
    return this.uow.prisma.package.findUnique({ where: { code } });
  }

  providerById(id: string) {
    return this.uow.prisma.provider.findUnique({ where: { id } });
  }

  /** Writes a package's operation flags and modes. */
  saveModes(code: string, data: Prisma.PackageUpdateInput) {
    return this.uow.prisma.package.update({ where: { code }, data });
  }

  /** A package with everything its sheet shows: provider, company, line statuses, renewal and switch targets. */
  packageSheet(code: string) {
    return this.uow.prisma.package.findUnique({
      where: { code },
      include: {
        provider: true,
        company: true,
        lines: { select: { status: true } },
        renewals: { include: { target: { select: { code: true } } } },
        switches: { include: { target: { select: { code: true } } } },
        durations: { orderBy: [{ position: 'asc' }, { unit: 'asc' }, { count: 'asc' }] },
      },
    });
  }

  /** Writes fields of one package: its details, or its price chain. */
  savePackage(id: string, data: Prisma.PackageUpdateInput) {
    return this.uow.prisma.package.update({ where: { id }, data });
  }

  /** A package with its extra operations in their order. */
  packageWithAddons(code: string) {
    return this.uow.prisma.package.findUnique({ where: { code }, include: { addons: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } });
  }

  addonById(id: string) {
    return this.uow.prisma.packageAddon.findUnique({ where: { id } });
  }

  saveAddon(id: string, data: Prisma.PackageAddonUpdateInput) {
    return this.uow.prisma.packageAddon.update({ where: { id }, data });
  }

  /** How many extra operations a package has; a new one takes this as its position. */
  addonCount(packageId: string) {
    return this.uow.prisma.packageAddon.count({ where: { packageId } });
  }

  addAddon(data: Prisma.PackageAddonUncheckedCreateInput) {
    return this.uow.prisma.packageAddon.create({ data });
  }

  removeAddon(id: string) {
    return this.uow.prisma.packageAddon.delete({ where: { id } });
  }

  /** A package with the company and provider its targets must share. */
  packageWithCompany(code: string) {
    return this.uow.prisma.package.findUnique({ where: { code }, include: { company: true, provider: true } });
  }

  /** The packages named as targets, each with its company and provider. */
  packagesByCodes(codes: string[]) {
    return this.uow.prisma.package.findMany({
      where: { code: { in: codes } },
      include: { company: true, provider: true },
    });
  }

  clearRenewalTargets(db: Db, packageId: string) {
    return db.packageRenewal.deleteMany({ where: { packageId } });
  }

  addRenewalTargets(db: Db, data: Prisma.PackageRenewalCreateManyInput[]) {
    return db.packageRenewal.createMany({ data });
  }

  clearSwitchTargets(db: Db, packageId: string) {
    return db.packageSwitch.deleteMany({ where: { packageId } });
  }

  addSwitchTargets(db: Db, data: Prisma.PackageSwitchCreateManyInput[]) {
    return db.packageSwitch.createMany({ data });
  }
}
