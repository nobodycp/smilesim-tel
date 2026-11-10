import { issueSerial, simRefusal } from './sim-rules';

describe('issueSerial', () => {
  it('starts with the company prefix, fills to its length with digits, and passes the same rules', () => {
    const rules = { length: 19, prefix: '8997202', esim: true };
    const serial = issueSerial(rules, () => 0.37);
    expect(serial).toBe('8997202333333333333');
    expect(simRefusal(rules, serial)).toBeNull();
  });

  it('uses 19 digits when the company sets no length', () => {
    const serial = issueSerial({ length: null, prefix: '', esim: true });
    expect(serial).toMatch(/^\d{19}$/);
  });
});
