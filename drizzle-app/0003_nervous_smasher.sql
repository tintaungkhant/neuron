ALTER TABLE "chats" ALTER COLUMN "ext_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_ext_id_unique" UNIQUE("ext_id");