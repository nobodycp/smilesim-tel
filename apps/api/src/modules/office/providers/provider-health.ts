// Provider health (spec 2026-11-08-overview-and-reports-nav, G). Pure: the callers load the figures.
//
// A provider has a problem when its recent operations failed (FAILURE_THRESHOLD or more in the last
// FAILURE_WINDOW_MINUTES) or its available balance fell under the owner's floor. Otherwise it is working.
// No provider is called through a real API yet, so «the last API call failed» joins this rule with the adapters.

export const FAILURE_THRESHOLD = 3;
export const FAILURE_WINDOW_MINUTES = 60;
/** How often the API looks again (ProviderHealthService). */
export const HEALTH_CHECK_SECONDS = 120;

export type HealthReason = 'failures' | 'balance';
export type Health = { status: 'working' | 'problem'; reason: HealthReason | null };

export function healthOf(input: { available: number; alertFloor: number; recentFailures: number }): Health {
  if (input.recentFailures >= FAILURE_THRESHOLD) return { status: 'problem', reason: 'failures' };
  if (input.available < input.alertFloor) return { status: 'problem', reason: 'balance' };
  return { status: 'working', reason: null };
}
