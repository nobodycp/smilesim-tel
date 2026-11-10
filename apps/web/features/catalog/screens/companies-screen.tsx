'use client';

import Link from 'next/link';
import { TableSkeleton } from '../../../components/loading';
import { LoadFailed } from '../../../components/load-failed';
import { EmptyState } from '../../../components/empty-state';
import { hasSimRules } from '../../../lib/sim-rules';
import { Desk } from '../../../components/desk';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type Shelf } from '../../../lib/api';
import { markColor, markOf } from '../../../lib/company-mark';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { DataImage } from '../../../components/data-image';
import { Plus } from 'lucide-react';
import { buttonClass } from '../../../components/ui/button';
import { useOffice } from '../../../lib/office-session';

const BRANCH = ['branch'];
type Company = Shelf['companies'][number];

/** A count's words with the figure in bold, as in the design («**6** رزمة»). */
function counted(template: string, n: number) {
  const [before, after] = template.split('{n}');
  return <>{before}<b className="num">{n}</b>{after}</>;
}

function totals(company: Company) {
  const packages = company.providers.flatMap((provider) => provider.packages);
  return {
    packages: packages.length,
    active: packages.reduce((sum, item) => sum + item.activeLines, 0),
    stopped: packages.reduce((sum, item) => sum + item.stoppedLines, 0),
  };
}

export function CompaniesScreen() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(BRANCH);
  const { me } = useOffice();
  const canAdd = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const shelf = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });

  // Each company a cut-corner card: its mark, its name, its SIM rules, then its packages and providers. The whole card
  // opens the company, where its settings and picture live (spec 2026-11-11-ui-consistency-pass, D2).
  const card = (company: Company) => {
    const sums = totals(company);
    return (
      <article key={company.code} className="co-card">
        <div className="co-top">
          {company.image ? (
            <DataImage className="co-mark big" src={company.image} alt="" />
          ) : (
            <span className="co-mark big" style={{ background: markColor(company.name) }} aria-hidden="true">{markOf(company.name)}</span>
          )}
        </div>
        <Link className="co-link" href={`/companies/${company.code}`}>{company.name}</Link>
        <span className="co-sim">
          {company.sim && hasSimRules(company.sim)
            ? [
                company.sim.length !== null ? t.simDigits.replace('{n}', String(company.sim.length)) : '',
                company.sim.prefix ? t.simStarts.replace('{p}', company.sim.prefix) : '',
              ].filter(Boolean).join(' · ')
            : t.simFree}
        </span>
        <div className="co-nums">
          <span>{counted(t.coPackages, sums.packages)}</span>
          <span>{counted(t.coProviders, company.providers.length)}</span>
          <span>{counted(t.coActive, sums.active)}</span>
        </div>
      </article>
    );
  };
  const companies = shelf.data?.companies ?? [];

  return (
    <Desk
      title={allowed ? t.companiesTitle : ''}
      lede={t.companiesLede}
      // A company the provider sells (spec 2026-11-09-admin-review, 3): owner or the edit grant.
      action={canAdd ? <Link className={buttonClass({})} href="/companies/new"><Plus size={16} aria-hidden="true" />{t.addCompany}</Link> : undefined}
      error=""
      note=""
    >
      {!shelf.loaded ? (
        <section className="pane"><TableSkeleton rows={4} columns={3} /></section>
      ) : shelf.error ? (
        <section className="pane"><LoadFailed message={shelf.error} onRetry={() => void shelf.reload()} /></section>
      ) : companies.length === 0 ? (
        <section className="pane"><EmptyState icon="providers">{t.noCompanies}</EmptyState></section>
      ) : (
        <div className="co-grid">{companies.map(card)}</div>
      )}
    </Desk>
  );
}
