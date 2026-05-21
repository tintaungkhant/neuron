CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_messages_session_idx" ON "agent_messages" USING btree ("session_id","id");