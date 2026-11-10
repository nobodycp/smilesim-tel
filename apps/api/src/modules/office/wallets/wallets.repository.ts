import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: wallets and wallet entries as the finance pages read them. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class WalletsRepository {
  constructor(readonly uow: UnitOfWork) {}
}
