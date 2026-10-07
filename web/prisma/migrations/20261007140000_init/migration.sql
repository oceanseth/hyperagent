-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "phab_canvas_stacks" (
    "workspace_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_canvas_stacks_pkey" PRIMARY KEY ("workspace_id","id")
);

-- CreateTable
CREATE TABLE "phab_canvas_jobs" (
    "workspace_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" TEXT NOT NULL DEFAULT 'Queued',
    "stack_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "worker_id" TEXT,
    "worker_region" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "replaces" JSONB NOT NULL DEFAULT '[]',
    "kind" TEXT NOT NULL DEFAULT 'research',
    "browser_id" UUID,

    CONSTRAINT "phab_canvas_jobs_pkey" PRIMARY KEY ("workspace_id","id")
);

-- CreateTable
CREATE TABLE "phab_job_events" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "tool" TEXT,
    "duration_ms" DOUBLE PRECISION,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "phab_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phab_chat_messages" (
    "workspace_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "modality" TEXT NOT NULL DEFAULT 'chat',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_chat_messages_pkey" PRIMARY KEY ("workspace_id","id")
);

-- CreateTable
CREATE TABLE "phab_canvas_notes" (
    "workspace_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "promoted_plan_id" UUID,
    "promoted_node_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_canvas_notes_pkey" PRIMARY KEY ("workspace_id","id")
);

-- CreateTable
CREATE TABLE "phab_canvas_layout" (
    "workspace_id" UUID NOT NULL,
    "positions" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_canvas_layout_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "phab_share_codes" (
    "code" TEXT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled board',
    "owner_sub" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_share_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "phab_board_members" (
    "sub" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_board_members_pkey" PRIMARY KEY ("sub","code")
);

-- CreateTable
CREATE TABLE "phab_canvas_browsers" (
    "workspace_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_canvas_browsers_pkey" PRIMARY KEY ("workspace_id","id")
);

-- CreateTable
CREATE TABLE "phab_plans" (
    "workspace_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_plans_pkey" PRIMARY KEY ("workspace_id","id")
);

-- CreateTable
CREATE TABLE "phab_published_plans" (
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tree" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_published_plans_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "phab_payment_methods" (
    "workspace_id" UUID NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_payment_methods_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "phab_workspace_settings" (
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phab_workspace_settings_pkey" PRIMARY KEY ("workspace_id","key")
);

-- CreateIndex
CREATE INDEX "phab_job_events_workspace_job_id_idx" ON "phab_job_events"("workspace_id", "job_id", "id" DESC);

-- CreateIndex
CREATE INDEX "phab_chat_messages_workspace_created_idx" ON "phab_chat_messages"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "phab_share_codes_workspace_idx" ON "phab_share_codes"("workspace_id");

