// Shapes every office domain shares. Moved out of office.service.ts with the kernel (Phase 3.0).

export type Gate = { sessionId?: string; homeId?: string };

export type Actor = {
  id: string;
  loginName: string;
  nickname: string;
  layer: string;
  isBranchOwner: boolean;
  grants: string[];
  operatorId: string;
  impersonating: boolean;
};

export type Account = { id: string; loginName: string; nickname: string; layer: string; parentId: string | null; deniedOps: string; disabledAt: Date | null };

export type Sale = {
  msisdn: string;
  lineId: string;
  companyName: string;
  packageName: string;
  packagePrice: number;
  providerCost?: number;
  /** The eSIM fee that is part of this entry's amount, so the finance row can explain amount − package price. */
  esimPrice?: number;
  /** The period a prepaid row bought. A switch has no end: it reprices the open periods. */
  period?: { days: number; endsAt: Date | null };
};

/** A line operation, as a task names it. */
export type Action = 'activate' | 'charge' | 'extend' | 'reactivate' | 'disconnect' | 'freeze' | 'unfreeze' | 'switch' | 'rename' | 'sim' | 'esim' | 'refresh';
