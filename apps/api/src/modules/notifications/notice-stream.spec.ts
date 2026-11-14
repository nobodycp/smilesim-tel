import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { Actor } from '../office/kernel/types';
import type { NoticeInboxService } from './notice-inbox.service';
import { NoticesController } from './notices.controller';

// The live notices stream (`GET /office/notices/stream`), moved to `modules/notifications` by slice R.2 and not
// changed: it subscribes the account's channel, writes each message as an event, pings and checks the session on
// every 25 s beat, ends the stream when the session is no longer live, and unsubscribes once when the browser goes.

const BEAT = 25_000;
const actor = { id: 'pos1' } as Actor;

function stream(live: () => boolean) {
  const calls = { subscribed: [] as string[], unsubscribed: 0, checked: [] as (string | undefined)[] };
  let handler: ((message: string) => void) | null = null;
  const inbox = {
    async subscribe(who: Actor, onMessage: (message: string) => void) {
      calls.subscribed.push(who.id);
      handler = onMessage;
      return async () => {
        calls.unsubscribed += 1;
      };
    },
    async sessionLive(sessionId: string | undefined) {
      calls.checked.push(sessionId);
      return live();
    },
  } as unknown as NoticeInboxService;
  const req = Object.assign(new EventEmitter(), { headers: { cookie: 'sid=stream-session' } }) as unknown as Request & EventEmitter;
  const written: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    headers: {} as Record<string, string>,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    flushHeaders() {},
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
  });
  return { controller: new NoticesController(inbox), req, res: res as unknown as Response & typeof res, written, calls, push: (message: string) => handler?.(message) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('the live notices stream', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
  afterEach(() => jest.useRealTimers());

  it('opens as server-sent events on the account’s own channel and writes each message as an event', async () => {
    const s = stream(() => true);
    await s.controller.noticeStream(actor, s.req, s.res);
    expect(s.calls.subscribed).toEqual(['pos1']);
    expect([s.res.statusCode, s.res.headers['Content-Type'], s.res.headers['Cache-Control']]).toEqual([200, 'text/event-stream', 'no-cache, no-transform']);
    s.push('{"id":"n1"}');
    expect(s.written).toEqual([': open\n\n', 'event: notice\ndata: {"id":"n1"}\n\n']);
  });

  it('pings and checks the session it was opened with on every beat, and stays open while it is live', async () => {
    const s = stream(() => true);
    await s.controller.noticeStream(actor, s.req, s.res);
    jest.advanceTimersByTime(BEAT * 2);
    await settle();
    expect(s.written.filter((chunk) => chunk === ': ping\n\n')).toHaveLength(2);
    expect(s.calls.checked).toEqual(['stream-session', 'stream-session']);
    expect([s.res.ended, s.calls.unsubscribed]).toEqual([false, 0]);
  });

  it('ends the stream and unsubscribes once the session is no longer live (signed out, frozen, revoked, idle)', async () => {
    let live = true;
    const s = stream(() => live);
    await s.controller.noticeStream(actor, s.req, s.res);
    live = false;
    jest.advanceTimersByTime(BEAT);
    await settle();
    expect([s.res.ended, s.calls.unsubscribed]).toEqual([true, 1]);
    // No further beat: the timer is gone.
    jest.advanceTimersByTime(BEAT * 3);
    await settle();
    expect(s.calls.checked).toHaveLength(1);
  });

  it('unsubscribes once when the browser goes, and beats no more', async () => {
    const s = stream(() => true);
    await s.controller.noticeStream(actor, s.req, s.res);
    s.req.emit('close');
    s.res.emit('error', new Error('socket gone'));
    await settle();
    expect(s.calls.unsubscribed).toBe(1);
    jest.advanceTimersByTime(BEAT * 3);
    await settle();
    expect(s.calls.checked).toEqual([]);
  });
});
