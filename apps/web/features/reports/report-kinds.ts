/** The reports `/reports/[kind]` draws, each with its title's copy key. Any other kind is no page (404). */
export const REPORT_KINDS = {
  providers: 'reportProviders',
  tasks: 'reportTasks',
  numbers: 'reportNumbers',
  operations: 'reportOperations',
} as const;

export type ReportKind = keyof typeof REPORT_KINDS;
