ALTER TABLE "executions" ADD COLUMN "tokens_prompt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "tokens_completion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "tokens_total" integer DEFAULT 0 NOT NULL;