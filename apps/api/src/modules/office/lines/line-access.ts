import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { AccountTree } from '../kernel/account-tree';
import type { Actor } from '../kernel/types';
import { UnitOfWork } from '../kernel/unit-of-work';
import { visibleAccountIds } from '../rules/office-rules';
import { deniedOpsFor } from '../rules/user-terms';

/** A number as the actor may reach it. */
@Injectable()
export class LineAccess {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree) {}

  /**
   * The line with its package, when the actor may see the point of sale that owns it: 404 when it does not exist,
   * 403 when it is not theirs. It carries the owner's path and the operations stopped on that path.
   */
  async visibleLine(actor: Actor, lineId: string) {
    const line = await this.uow.prisma.line.findUnique({
      where: { id: lineId },
      include: { package: { include: { company: true, provider: true } } },
    });
    if (!line) fail(404, 'NOT_FOUND');
    if (!line.package.company || !line.package.provider) fail(400, 'INVALID');
    const accounts = await this.tree.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(404, 'NOT_FOUND');
    // The stop belongs to the selling account that owns the line, not to whoever clicks. The path
    // travels with the line so later price and visibility checks do not load the accounts again.
    const posPath = this.tree.pathOf(line.posId, accounts);
    return Object.assign(line, { denied: deniedOpsFor(posPath), posPath });
  }
}
