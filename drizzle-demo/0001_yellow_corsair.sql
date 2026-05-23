CREATE TABLE "chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"ext_id" bigint,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"account_name" text,
	"account_number" text,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;