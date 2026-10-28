import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { enableWebCors } from './cors';

describe('web CORS', () => {
  let app: INestApplication;

  async function boot() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    enableWebCors(app);
    await app.init();
  }

  afterEach(async () => {
    await app.close();
    delete process.env.WEB_ORIGIN;
  });

  it('allows the local web origin with credentials by default', async () => {
    await boot();
    const response = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('takes the origin from WEB_ORIGIN', async () => {
    process.env.WEB_ORIGIN = 'https://app.example.com';
    await boot();
    const response = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
