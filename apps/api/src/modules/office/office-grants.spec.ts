import { effectiveGrantCodes, roleGrantCodes } from './office-grants';

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
});
