// The signed-in actor and an account, as access reads them (slice R.3: from the kernel's types).

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

/** An account on a path up the tree. Index 0 is the user, the last entry is the root (slice R.3: from `user-terms.ts`). */
export type PathNode = { id: string; loginName: string; layer: string; deniedOps: string };
