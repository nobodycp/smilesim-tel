import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Mount Swagger UI at `/docs` outside production. */
export function setupOpenApi(app: INestApplication): void {
  if (process.env.NODE_ENV === 'production') return;

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('SmileSIM API')
      .setDescription(
        'Office wholesale API. Session cookie `sid`; door header `x-door` (`admin` | `main` | `agent` | `pos`). Refusals use `{ message, code }` from `errors.ts`.',
      )
      .setVersion('1.0')
      .addCookieAuth('sid', {
        type: 'apiKey',
        in: 'cookie',
        name: 'sid',
        description: 'HttpOnly session cookie set by login / 2FA / impersonation',
      })
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'x-door',
          description: 'Door host key: admin | main | agent | pos',
        },
        'x-door',
      )
      .addTag('health', 'Liveness')
      .addTag('auth', 'Login, profile, sessions, 2FA, policy')
      .addTag('office', 'Desk operations behind a door session')
      .build(),
  );

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
