import { NoticeService, type NoticeBus } from './notice.service';

type Created = { userId: string; kind: string; payload: unknown; actorId: string | null; actorName: string; href: string };

function memoryBus(): NoticeBus & { published: { channel: string; message: string }[]; handlers: Map<string, (message: string) => void> } {
  const published: { channel: string; message: string }[] = [];
  const handlers = new Map<string, (message: string) => void>();
  return {
    published,
    handlers,
    publish: async (channel, message) => {
      published.push({ channel, message });
      handlers.get(channel)?.(message);
    },
    subscribe: async (channel, handler) => {
      handlers.set(channel, handler);
      return async () => {
        handlers.delete(channel);
      };
    },
  };
}

function fakeTx(created: Created[]) {
  return {
    notice: {
      createMany: async (args: { data: Created[] }) => {
        created.push(...args.data);
        return { count: args.data.length };
      },
    },
  };
}

describe('notice writer', () => {
  const actor = { id: 'u-actor', nickname: 'سامي' };
  const draft = {
    kind: 'task.opened' as const,
    payload: { taskId: 't1', action: 'switch', msisdn: '0550000001', packageName: '400 جيجا', amount: -183 },
  };

  it('writes one row per recipient, skipping the actor and duplicates, with the record link', async () => {
    const created: Created[] = [];
    const service = new NoticeService(memoryBus());
    const rows = await service.write(fakeTx(created) as never, ['u1', 'u2', 'u1', 'u-actor'], actor, draft);
    expect(created.map((row) => row.userId)).toEqual(['u1', 'u2']);
    expect(created[0]).toMatchObject({ kind: 'task.opened', actorId: 'u-actor', actorName: 'سامي', href: '/tasks/t1' });
    expect(rows).toHaveLength(2);
  });

  it('writes nothing when every recipient is the actor', async () => {
    const created: Created[] = [];
    const service = new NoticeService(memoryBus());
    const rows = await service.write(fakeTx(created) as never, ['u-actor'], actor, draft);
    expect(created).toEqual([]);
    expect(rows).toEqual([]);
  });

  // ADR 0019, D12: a notice the settlement writes in the submitter's name reaches the submitter too.
  it('tells the actor only when asked to, for a notice written in the actor\'s name by something else', async () => {
    const created: Created[] = [];
    const service = new NoticeService(memoryBus());
    const rows = await service.write(fakeTx(created) as never, ['u1', 'u-actor', 'u-actor', ''], actor, draft, { tellActor: true });
    expect(created.map((row) => row.userId)).toEqual(['u1', 'u-actor']);
    expect(created.every((row) => row.actorId === 'u-actor' && row.actorName === 'سامي')).toBe(true);
    expect(rows).toHaveLength(2);
    // Not asked, asked with false, or with an empty option: the rule for every other notice.
    for (const options of [undefined, {}, { tellActor: false }]) {
      const plain: Created[] = [];
      await service.write(fakeTx(plain) as never, ['u1', 'u-actor'], actor, draft, options);
      expect(plain.map((row) => row.userId)).toEqual(['u1']);
    }
    // The actor is never added to an audience it is not in.
    const others: Created[] = [];
    await service.write(fakeTx(others) as never, ['u1', 'u2'], actor, draft, { tellActor: true });
    expect(others.map((row) => row.userId)).toEqual(['u1', 'u2']);
  });

  it('publishes each written notice on the recipient channel after commit', async () => {
    const bus = memoryBus();
    const service = new NoticeService(bus);
    const received: string[] = [];
    await service.subscribe('u1', (message) => received.push(message));
    const created: Created[] = [];
    const rows = await service.write(fakeTx(created) as never, ['u1', 'u2'], actor, draft);
    expect(bus.published).toEqual([]);
    await service.publish(rows);
    expect(bus.published.map((item) => item.channel).sort()).toEqual(['notice:u1', 'notice:u2']);
    expect(JSON.parse(received[0])).toMatchObject({ kind: 'task.opened', href: '/tasks/t1', read: false });
  });
});
