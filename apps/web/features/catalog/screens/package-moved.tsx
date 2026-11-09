'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageSkeleton } from '../../../components/loading';
import { api } from '../../../lib/api';
import { packageHref } from '../company-packages';

/**
 * `/providers/[p]/[pkg]`, the package page's old address: it now lives under its company (spec
 * 2026-11-09-admin-review, 4). The package's company is read, then the page moves there without a history entry.
 */
export function PackageMoved() {
  const params = useParams<{ code: string; packageCode: string }>();
  const router = useRouter();
  useEffect(() => {
    let live = true;
    void api.packageSheet(params.packageCode).then((result) => {
      if (!live) return;
      router.replace(result.ok ? packageHref(result.data.companyCode, params.packageCode) : '/companies');
    });
    return () => {
      live = false;
    };
  }, [params.packageCode, router]);
  return <PageSkeleton />;
}
