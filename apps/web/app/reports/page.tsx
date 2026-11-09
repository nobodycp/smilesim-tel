import { redirect } from 'next/navigation';

// Each report is its own page since 2026-11-09; the sidebar's «التقارير» group lists them. `/reports` opens the first.
export default function ReportsPage() {
  redirect('/reports/sales');
}
