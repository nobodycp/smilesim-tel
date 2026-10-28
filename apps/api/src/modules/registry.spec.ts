// apps/api/src/modules/registry.spec.ts
import { featureModules } from './registry';

describe('featureModules', () => {
  it('starts empty until AuthModule is registered', () => {
    expect(featureModules).toEqual([]);
  });
});
