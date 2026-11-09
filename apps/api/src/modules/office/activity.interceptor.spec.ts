import 'reflect-metadata';
import { Controller, Get, INestApplication, Param, Post, UseFilters, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Activity, param } from './activity.decorator';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityRecorder } from './activity-recorder';
import { OfficeFailure } from '../shared/office-failure';
import { ApiExceptionFilter } from '../shared/api-exception.filter';

@Controller('t')
@UseFilters(ApiExceptionFilter)
@UseInterceptors(ActivityInterceptor)
class ProbeController {
  @Post(':login/:code')
  @Activity('user_package', 'user', (req) => `${param('login')(req)}:${param('code')(req)}`)
  ok(@Param('login') login: string) {
    return { ok: true, login };
  }

  @Post('refused')
  @Activity('fund', 'account')
  refused() {
    throw new OfficeFailure(403, 'FORBIDDEN');
  }

  @Post('broken')
  @Activity('fund', 'account')
  broken() {
    throw new Error('bug');
  }

  @Get('quiet')
  quiet() {
    throw new OfficeFailure(404, 'NOT_FOUND');
  }
}

describe('ActivityInterceptor and ApiExceptionFilter', () => {
  let app: INestApplication;
  const recorded: unknown[][] = [];

  beforeEach(async () => {
    recorded.length = 0;
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: ActivityRecorder, useValue: { recordOffice: async (...args: unknown[]) => void recorded.push(args) } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const events = () => recorded.map(([, , event, result, reason]) => [event, result, reason]);

  it('answers, then logs ok with the subject read from the request', async () => {
    const response = await request(app.getHttpServer()).post('/t/pos1/pkg9');
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true, login: 'pos1' });
    expect(events()).toEqual([[{ action: 'user_package', subjectKind: 'user', subjectRef: 'pos1:pkg9' }, 'ok', '']]);
  });

  it('turns a refusal into its status and { message, code }, and logs it as fail with the code', async () => {
    const response = await request(app.getHttpServer()).post('/t/refused');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'غير مسموح', code: 'FORBIDDEN' });
    expect(events()).toEqual([[{ action: 'fund', subjectKind: 'account', subjectRef: '' }, 'fail', 'FORBIDDEN']]);
  });

  it('leaves an unexpected error to Nest (500) and logs nothing', async () => {
    const response = await request(app.getHttpServer()).post('/t/broken');
    expect(response.status).toBe(500);
    expect(recorded).toEqual([]);
  });

  it('maps a refusal on a route without @Activity and logs nothing', async () => {
    const response = await request(app.getHttpServer()).get('/t/quiet');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: expect.any(String), code: 'NOT_FOUND' });
    expect(recorded).toEqual([]);
  });
});
