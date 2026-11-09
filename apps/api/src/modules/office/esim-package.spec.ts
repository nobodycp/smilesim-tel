import { tree } from './tree-fixture';

// eSIM per package (spec 2026-11-09-offers-tasks-addons-wallet-esim, 5): the company refusing eSIM answers
// ESIM_UNSUPPORTED; a package switched off answers ESIM_PACKAGE_OFF; both on lets it through.
describe('eSIM per package', () => {
  const activation = { packageCode: 'alloha-150', posLogin: 'pos1', esim: true, outcome: 'success' as const };

  it('refuses an eSIM activation on a package that is not offered as an eSIM', async () => {
    const { service, gates, pkgA } = await tree();
    pkgA.esimAvailable = false;
    await expect(service.activate(gates.pos1, activation)).rejects.toMatchObject({ code: 'ESIM_PACKAGE_OFF' });
  });

  it('keeps the company\'s own answer when the company refuses eSIM', async () => {
    const { service, gates, pkgA } = await tree();
    (pkgA.company as { esim: boolean }).esim = false;
    pkgA.esimAvailable = false;
    await expect(service.activate(gates.pos1, activation)).rejects.toMatchObject({ code: 'ESIM_UNSUPPORTED' });
  });

  it('offers no eSIM request on a number whose package is switched off', async () => {
    const { service, gates, pkgA } = await tree();
    pkgA.esimAvailable = false;
    const card = await service.line(gates.pos1, 'ln1');
    expect(card.line.operations).not.toContain('esim');
    await expect(service.requestEsim(gates.pos1, 'ln1')).rejects.toMatchObject({ code: 'ESIM_PACKAGE_OFF' });
  });
});
