CREATE TABLE "executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"step_count" integer NOT NULL,
	"trace" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "executions_created_idx" ON "executions" USING btree ("created_at");