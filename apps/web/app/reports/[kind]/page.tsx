import { notFound } from 'next/navigation';
import { REPORT_KINDS } from '../../../features/reports/report-kinds';
import { ReportScreen } from '../../../features/reports/screens/report-screen';

/** A report by its kind; a kind that names no report is not a page (the old report addresses are gone, F.7c). */
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(kind in REPORT_KINDS)) notFound();
  return <ReportScreen />;
}
