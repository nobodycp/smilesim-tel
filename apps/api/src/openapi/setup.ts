import { isProduction } from '../config';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Mount Swagger UI at `/docs` outside production. */
export function setupOpenApi(app: INestApplication): void {
  if (isProduction()) return;

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
      // One tag a module (slice R.9; before it one tag, `office`). Routes and their paths are unchanged.
      .addTag('access', 'Accounts, roles, entering an account')
      .addTag('auditing', 'The activity log')
      .addTag('notifications', 'Notices: inbox and live stream')
      .addTag('catalog', 'Companies, packages, offers, the shipped catalog')
      .addTag('pricing', 'Per-account terms, the priced shelf, sell prices')
      .addTag('wallets', 'Wallets, funding, ceilings, finance')
      .addTag('providers', 'Providers: settings, accounts, dispatch')
      .addTag('tasks', 'Branch tasks')
      .addTag('sales', 'Lines, activation, settlement, decisions, transfers')
      .addTag('reporting', 'Reports, home, overview')
      .build(),
  );

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
