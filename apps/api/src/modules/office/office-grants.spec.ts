import { GRANT_CODES, LAYER_GRANTS, effectiveGrantCodes, roleGrantCodes, splitGrants } from './office-grants';

describe('effective grants', () => {
  it('keeps an old staff role that only has the boolean flags', () => {
    expect(roleGrantCodes({ grants: '', read: true, tasks: true, edit: false })).toEqual(['read', 'tasks']);
  });

  it('lets one agent transfer numbers and blocks another on the same role', () => {
    const layerRole = { grants: 'read,accounting,tasks,transferLines' };
    const allowed = effectiveGrantCodes({
      owner: false,
      staff: false,
      layer: 'agent',
      layerRole,
      roles: [],
      extra: 'transferPos',
      denied: '',
    });
    const blocked = effectiveGrantCodes({
      owner: false,
      staff: false,
      layer: 'agent',
      layerRole,
      roles: [],
      extra: '',
      denied: 'transferLines',
    });
    expect(allowed).toContain('transferLines');
    expect(allowed).toContain('transferPos');
    expect(blocked).not.toContain('transferLines');
  });

  it('stacks a second role on a staff account and still honours a block', () => {
    const grants = effectiveGrantCodes({
      owner: false,
      staff: true,
      layer: 'branch',
      layerRole: { grants: 'read,edit,accounting,tasks,reports,staff,enter,transferLines,transferPos' },
      roles: [{ grants: 'read,tasks' }, { grants: 'reports,accounting' }],
      extra: '',
      denied: 'reports',
    });
    expect(grants).toEqual(['read', 'accounting', 'tasks']);
  });

  it('gives the branch owner every permission', () => {
    const grants = effectiveGrantCodes({
      owner: true,
      staff: false,
      layer: 'branch',
      layerRole: null,
      roles: [],
      extra: '',
      denied: 'transferLines',
    });
    expect(grants).toContain('transferLines');
    expect(grants).toContain('enter');
  });

  it('moves agents only with transferAgents: a code the role form can store and the owner always holds', () => {
    expect(GRANT_CODES).toContain('transferAgents');
    expect(splitGrants('transferLines,transferAgents,bogus')).toEqual(['transferLines', 'transferAgents']);
    expect(roleGrantCodes({ grants: 'read,transferAgents' })).toEqual(['read', 'transferAgents']);
    const owner = effectiveGrantCodes({ owner: true, staff: false, layer: 'branch', layerRole: null, roles: [], extra: '', denied: 'transferAgents' });
    expect(owner).toContain('transferAgents');
  });

  it('gives branch staff transferAgents through a job role only, and a block still wins', () => {
    const staff = { owner: false, staff: true, layer: 'branch', layerRole: null, extra: '' } as const;
    expect(effectiveGrantCodes({ ...staff, roles: [], denied: '' })).toEqual([]);
    expect(effectiveGrantCodes({ ...staff, roles: [{ grants: 'read,transferAgents' }], denied: '' })).toEqual(['read', 'transferAgents']);
    expect(effectiveGrantCodes({ ...staff, roles: [{ grants: 'read,transferAgents' }], denied: 'transferAgents' })).toEqual(['read']);
  });

  it('leaves transferAgents out of every layer below the branch by default', () => {
    expect(LAYER_GRANTS.branch).toContain('transferAgents');
    for (const layer of ['main_agent', 'agent', 'pos']) {
      expect(LAYER_GRANTS[layer]).not.toContain('transferAgents');
      const held = effectiveGrantCodes({ owner: false, staff: false, layer, layerRole: null, roles: [], extra: '', denied: '' });
      expect(held).not.toContain('transferAgents');
    }
  });
});
