'use client';

import Link from 'next/link';
import { TableSkeleton } from '../../../components/loading';
import { LoadFailed } from '../../../components/load-failed';
import { EmptyState } from '../../../components/empty-state';
import { hasSimRules } from '../../../lib/sim-rules';
import { Desk, Pane } from '../../../components/desk';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type Shelf } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { CompanyMark } from '../../../components/company-mark';
import { Plus } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useDesk } from '../../../lib/desk-session';

const BRANCH = ['branch'];
type Company = Shelf['companies'][number];

/** A count's words with the figure in bold ink, as in the design («**6** رزمة»). */
function counted(template: string, n: number) {
  const [before, after] = template.split('{n}');
  return <>{before}<b className="font-bold text-ink">{n}</b>{after}</>;
}

/*
 * The company cards (Tailwind migration T4.3, ADR 0022), ported from graphite.css's company shelf:
 * - the grid: as many 220px-or-wider columns as fit, 12px apart; two columns 10px apart under 641px; when motion is
 *   allowed each card rises in (8px, 420ms), the second 40ms, the third 80ms and the rest 120ms after the first;
 * - the card: a grid of rows 6px apart with 18px padding (14px under 641px), 6px corners on `--rd-surface` with a 1px
 *   inset `--rd-line` edge and the tag's cut corner (`--rd-cut`) at the top inline end; `--rd-surface-2` under the
 *   pointer (140ms); the edge becomes a 2px `--rd-accent` ring while its link has keyboard focus;
 * - the top row (the mark) at the start, 6px over the name; the mark 38px with 15px letters under 641px;
 * - the name: the card's link, 15px bold ink, stretched over the whole card (its `::after`), no focus outline of its
 *   own (the card's ring shows it);
 * - the SIM rules: 12.5px `--rd-muted`;
 * - the counts: one wrapping row 14px apart (4px by 10px and 11.5px under 641px), 8px over and 10px inside a 1px
 *   `--rd-line` rule, 12px `--rd-muted` with the figures in bold ink.
 * `data-slot="company-card"` is the card's handle.
 */
const GRID = cn(
  'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 max-sm:grid-cols-2 max-sm:gap-2.5',
  'motion-safe:*:animate-rise',
  'motion-safe:[&>:nth-child(2)]:[animation-delay:40ms] motion-safe:[&>:nth-child(3)]:[animation-delay:80ms]',
  'motion-safe:[&>:nth-child(n+4)]:[animation-delay:120ms]',
);
const CARD = cn(
  'relative isolate grid gap-1.5 rounded-sm bg-surface p-4.5 text-start inset-ring inset-ring-line max-sm:p-3.5',
  '[clip-path:polygon(0_0,calc(100%_-_var(--rd-cut))_0,100%_var(--rd-cut),100%_100%,0_100%)]',
  'rtl:[clip-path:polygon(var(--rd-cut)_0,100%_0,100%_100%,0_100%,0_var(--rd-cut))]',
  'transition-colors duration-fast ease-standard hover:bg-surface-2',
  'has-[a:focus-visible]:inset-ring-2 has-[a:focus-visible]:inset-ring-accent',
);
const CARD_LINK = cn(
  'text-lg font-bold text-ink no-underline focus-visible:outline-none',
  "after:absolute after:inset-0 after:z-1 after:content-['']",
);

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
  const { me } = useDesk();
  const canAdd = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const shelf = useApiQuery(sharedKeys.companies, () => api.companies(), { enabled: allowed });

  // Each company a cut-corner card: its mark, its name, its SIM rules, then its packages and providers. The whole card
  // opens the company, where its settings and picture live (spec 2026-11-11-ui-consistency-pass, D2).
  const card = (company: Company) => {
    const sums = totals(company);
    return (
      <article key={company.code} className={CARD} data-slot="company-card">
        <div className="mb-1.5 flex items-start justify-between">
          <CompanyMark name={company.name} image={company.image} size="lg" className="max-sm:size-9.5 max-sm:text-lg" />
        </div>
        <Link className={CARD_LINK} href={`/companies/${company.code}`}>{company.name}</Link>
        <span className="text-chip text-muted">
          {company.sim && hasSimRules(company.sim)
            ? [
                company.sim.length !== null ? t.simDigits.replace('{n}', String(company.sim.length)) : '',
                company.sim.prefix ? t.simStarts.replace('{p}', company.sim.prefix) : '',
              ].filter(Boolean).join(' · ')
            : t.simFree}
        </span>
        <div className="mt-2 flex flex-wrap gap-3.5 border-t border-line pt-2.5 text-sm text-muted max-sm:gap-x-2.5 max-sm:gap-y-1 max-sm:text-caption">
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
      action={canAdd ? <Button asChild><Link href="/companies/new"><Plus size={16} aria-hidden="true" />{t.addCompany}</Link></Button> : undefined}
      error=""
      note=""
    >
      {!shelf.loaded ? (
        <Pane><TableSkeleton rows={4} columns={3} /></Pane>
      ) : shelf.error ? (
        <Pane><LoadFailed message={shelf.error} onRetry={() => void shelf.reload()} /></Pane>
      ) : companies.length === 0 ? (
        <Pane><EmptyState icon="providers">{t.noCompanies}</EmptyState></Pane>
      ) : (
        <div className={GRID}>{companies.map(card)}</div>
      )}
    </Desk>
  );
}
