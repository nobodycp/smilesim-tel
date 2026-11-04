import { defineConfig } from 'prisma/config';

// Generate must succeed in CI without a database. Migrate uses DATABASE_URL when it is set.
const url = process.env.DATABASE_URL ?? 'postgresql://smilesim:smilesim@localhost:5432/smilesim';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
