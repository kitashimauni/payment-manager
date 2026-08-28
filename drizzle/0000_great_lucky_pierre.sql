CREATE TYPE "public"."group_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"status" "group_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "groups_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "groups_name_not_blank" CHECK (length(btrim("groups"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payment_methods_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "payment_methods_name_not_blank" CHECK (length(btrim("payment_methods"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"payment_method_id" text NOT NULL,
	"title" varchar(200),
	"group_id" text,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payments_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_settings" (
	"user_id" text NOT NULL,
	"current_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_settings_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_payment_method_fk" FOREIGN KEY ("user_id","payment_method_id") REFERENCES "public"."payment_methods"("user_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_group_fk" FOREIGN KEY ("user_id","group_id") REFERENCES "public"."groups"("user_id","id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_group_fk" FOREIGN KEY ("user_id","current_group_id") REFERENCES "public"."groups"("user_id","id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_user_updated_at_idx" ON "groups" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_methods_user_updated_at_idx" ON "payment_methods" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_paid_at_idx" ON "payments" USING btree ("user_id","paid_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_updated_at_idx" ON "payments" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_group_paid_at_idx" ON "payments" USING btree ("group_id","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_settings_user_updated_at_idx" ON "user_settings" USING btree ("user_id","updated_at");