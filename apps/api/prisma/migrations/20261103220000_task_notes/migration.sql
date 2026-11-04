-- Support-ticket notes on office tasks (inspection timeline; does not close the task).
CREATE TABLE "OfficeTaskNote" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeTaskNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeTaskNote_taskId_createdAt_idx" ON "OfficeTaskNote"("taskId", "createdAt");

ALTER TABLE "OfficeTaskNote" ADD CONSTRAINT "OfficeTaskNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OfficeTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeTaskNote" ADD CONSTRAINT "OfficeTaskNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
