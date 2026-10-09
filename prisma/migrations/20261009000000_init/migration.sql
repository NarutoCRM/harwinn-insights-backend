CREATE TYPE "Outcome" AS ENUM ('COMPLETE', 'TERMINATE', 'QUOTAFUL', 'DISQUALIFY');
CREATE TABLE "Admin" (
 "id" UUID NOT NULL, "email" VARCHAR(254) NOT NULL, "passwordHash" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");
CREATE TABLE "AdminSession" (
 "id" UUID NOT NULL, "tokenHash" CHAR(64) NOT NULL, "adminId" UUID NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE TABLE "Project" (
 "id" UUID NOT NULL, "pid" VARCHAR(128) NOT NULL, "name" VARCHAR(200) NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_pid_key" ON "Project"("pid");
CREATE TABLE "TrackingRecord" (
 "serial" BIGSERIAL NOT NULL, "projectId" UUID NOT NULL, "uid" VARCHAR(128) NOT NULL,
 "username" VARCHAR(200), "status" "Outcome" NOT NULL, "inTime" TIMESTAMPTZ(3),
 "outTime" TIMESTAMPTZ(3) NOT NULL, "loiSeconds" INTEGER, "ipAddress" INET, "country" CHAR(2),
 "transactionId" VARCHAR(128) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TrackingRecord_pkey" PRIMARY KEY ("serial"),
 CONSTRAINT "TrackingRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "TrackingRecord_time_check" CHECK (("inTime" IS NULL AND "loiSeconds" IS NULL) OR ("inTime" IS NOT NULL AND "loiSeconds" IS NOT NULL AND "inTime" <= "outTime" AND "loiSeconds" >= 0 AND "loiSeconds" = FLOOR(EXTRACT(EPOCH FROM ("outTime" - "inTime"))))),
 CONSTRAINT "TrackingRecord_country_check" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX "TrackingRecord_projectId_transactionId_key" ON "TrackingRecord"("projectId", "transactionId");
CREATE INDEX "TrackingRecord_projectId_createdAt_serial_idx" ON "TrackingRecord"("projectId", "createdAt", "serial");
CREATE INDEX "TrackingRecord_uid_idx" ON "TrackingRecord"("uid");
CREATE INDEX "TrackingRecord_status_createdAt_idx" ON "TrackingRecord"("status", "createdAt");
CREATE INDEX "TrackingRecord_country_createdAt_idx" ON "TrackingRecord"("country", "createdAt");
