import 'reflect-metadata';
import { Controller, Get, Param, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { applyErrorOf } from '../office/lines/activation-settlement.rules';
import { API_PROVIDERS } from './api-providers';
import { ApiFailure, fail } from './api-failure';
import { errorCode } from './log';

// The API's refusal (slice R.1, ADR 0020: `OfficeFailure` renamed `ApiFailure`, nothing else). What a refusal
// is must not change with its name: the status and code it carries, the message from the catalog, the body the
// filter answers, the code the worker logs, and how the settlement and the dispatcher tell a refusal of ours
// from a technical failure (both ask `instanceof ApiFailure`).

const CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

@Controller('probe')
class Probe {
  @Get(':status/:code')
  refuse(@Param('status') status: string, @Param('code') code: string) {
    fail(Number(status), code as ErrorCode);
  }
}

describe('ApiFailure', () => {
  it('fail() throws it, with the status and code it was given and the message of the catalog', () => {
    for (const code of CODES) {
      let thrown: unknown;
      try {
        fail(409, code);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ApiFailure);
      expect(thrown).toBeInstanceOf(Error);
      expect({ status: (thrown as ApiFailure).status, code: (thrown as ApiFailure).code, message: (thrown as ApiFailure).message }).toEqual({ status: 409, code, message: ERROR_MESSAGES[code] });
    }
  });

  it('keeps the name every Error has, so no log line and no failed job reads differently after the rename', () => {
    // The class never set `name`: a refusal reads as `Error: <message>`, before R.1 and after.
    expect(new ApiFailure(403, 'FORBIDDEN').name).toBe('Error');
    expect(String(new ApiFailure(403, 'FORBIDDEN'))).toBe(`Error: ${ERROR_MESSAGES.FORBIDDEN}`);
  });

  it('is logged by the worker as it was before the rename: `errorCode` names only socket and system codes', () => {
    // `errorCode` (log.ts) writes a code down only when it is in its fixed list of system codes; an API refusal
    // is not, so a failed job that threw one is logged `unclassified`. Pinned so the rename changes no log line.
    expect(errorCode(new ApiFailure(409, 'DUPLICATE_REQUEST'))).toBe('unclassified');
    expect(errorCode(new ApiFailure(404, 'NOT_FOUND'))).toBe('unclassified');
  });

  it('is what the settlement reads as a refusal that names the line it could not make', () => {
    // `activation-settlement.ts` and `provider-decisions.ts`: `error instanceof ApiFailure ? applyErrorOf(error) : null`.
    const asSettlement = (error: unknown) => (error instanceof ApiFailure ? applyErrorOf(error) : null);
    const thrown = (status: number, code: ErrorCode) => {
      try {
        fail(status, code);
      } catch (error) {
        return error;
      }
      return null;
    };
    expect(asSettlement(thrown(409, 'NUMBER_TAKEN'))).toBe('number-taken');
    expect(asSettlement(thrown(409, 'SIM_TAKEN'))).toBe('sim-taken');
    expect(asSettlement(thrown(404, 'NOT_FOUND'))).toBe('target-missing');
    // A refusal that names nothing, and a technical failure with the same fields, are not applied as an exception.
    expect(asSettlement(thrown(409, 'DUPLICATE_REQUEST'))).toBeNull();
    expect(asSettlement(Object.assign(new Error('lost'), { status: 409, code: 'NUMBER_TAKEN' }))).toBeNull();
  });

  describe('over HTTP, through the global filter', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ controllers: [Probe], providers: API_PROVIDERS }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it.each([
      [400, 'INVALID'],
      [401, 'LOGIN_REQUIRED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'DUPLICATE_REQUEST'],
      [409, 'NUMBER_TAKEN'],
      [429, 'RATE_LIMITED'],
    ] as const)('%i %s answers that status and exactly { message, code }', async (status, code) => {
      const response = await request(app.getHttpServer()).get(`/probe/${status}/${code}`);
      expect(response.status).toBe(status);
      expect(response.body).toEqual({ message: ERROR_MESSAGES[code], code });
      expect(Object.keys(response.body).sort()).toEqual(['code', 'message']);
    });
  });
});
