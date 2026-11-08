-- CreateIndex
CREATE INDEX "Line_status_idx" ON "Line"("status");

-- CreateIndex
CREATE INDEX "Line_packageId_idx" ON "Line"("packageId");

-- CreateIndex
CREATE INDEX "Line_iccid_idx" ON "Line"("iccid");

-- CreateIndex
CREATE INDEX "OfficeTask_assigneeId_status_idx" ON "OfficeTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "User_parentId_idx" ON "User"("parentId");

-- CreateIndex
CREATE INDEX "WalletEntry_kind_createdAt_idx" ON "WalletEntry"("kind", "createdAt");
