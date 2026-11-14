import 'reflect-metadata';
import { Controller, Get, Logger, Param, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LegacyPathCounter } from './legacy-paths';
import { RESOURCE_CONTROLLER_PREFIXES } from './route-prefixes';

// Slice R.11b: what the old paths are counted by. A request to `/office/…` is counted by its method and route
// pattern; nothing of the request itself (the parameter's value, the query) is kept; the current path is not
// counted; a report writes one line and starts the counts again.

@Controller(RESOURCE_CONTROLLER_PREFIXES)
class Lines {
  @Get('lines/:id')
  line(@Param('id') id: string) {
    return { id };
  }
}

describe('counting the old paths', () => {
  let app: INestApplication;
  let counter: LegacyPathCounter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [Lines] }).compile();
    app = moduleRef.createNestApplication();
    counter = new LegacyPathCounter();
    app.useGlobalInterceptors(counter);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    counter.onModuleDestroy();
  });

  it('counts an old-path request by its route pattern, never its values, and leaves the current path alone', async () => {
    const answers = await Promise.all([
      request(app.getHttpServer()).get('/office/lines/0521234567?q=secret-query'),
      request(app.getHttpServer()).get('/office/lines/another-id'),
      request(app.getHttpServer()).get('/v1/lines/0521234567'),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let rows: [string, number][];
    let lines: string[];
    try {
      rows = counter.report();
      lines = warned.mock.calls.map(([message]) => String(message));
    } finally {
      warned.mockRestore();
    }
    expect(rows).toEqual([['GET /office/lines/:id', 2]]);
    expect(lines).toEqual(['old paths used: GET /office/lines/:id x2']);
    expect(lines.join('\n')).not.toMatch(/0521234567|another-id|secret-query/);
    // The counts start again after a report: nothing to say, nothing written.
    expect(counter.report()).toEqual([]);
  });
});
