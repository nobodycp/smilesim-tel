import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: the rows the branch reports list. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class ReportsRepository {
  constructor(readonly uow: UnitOfWork) {}
}
