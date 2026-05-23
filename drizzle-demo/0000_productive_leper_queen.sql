CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"pricing" text NOT NULL,
	"requirements_from_customer" text NOT NULL
);
