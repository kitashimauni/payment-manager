CREATE SEQUENCE IF NOT EXISTS "sync_change_version_seq";
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "sync_version" bigint DEFAULT nextval('sync_change_version_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "sync_version" bigint DEFAULT nextval('sync_change_version_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "sync_version" bigint DEFAULT nextval('sync_change_version_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "sync_version" bigint DEFAULT nextval('sync_change_version_seq') NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_user_sync_version_idx" ON "groups" USING btree ("user_id","sync_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_methods_user_sync_version_idx" ON "payment_methods" USING btree ("user_id","sync_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_sync_version_idx" ON "payments" USING btree ("user_id","sync_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_settings_user_sync_version_idx" ON "user_settings" USING btree ("user_id","sync_version");
