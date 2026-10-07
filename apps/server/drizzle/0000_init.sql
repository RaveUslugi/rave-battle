CREATE TABLE "bombs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"removed_by" integer
);
--> statement-breakpoint
CREATE TABLE "chunk_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"cx" integer NOT NULL,
	"cy" integer NOT NULL,
	"colors" "bytea" NOT NULL,
	"owners" "bytea" NOT NULL,
	"last_event_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_config" (
	"version" serial PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" integer,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"user_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"item" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "inventory_user_id_season_id_item_pk" PRIMARY KEY("user_id","season_id","item")
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"item" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"action" text NOT NULL,
	"target_user_id" integer,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pixel_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"user_id" integer,
	"color_id" smallint NOT NULL,
	"prev_color_id" smallint NOT NULL,
	"prev_user_id" integer,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_state" (
	"user_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"coins" integer NOT NULL,
	"charges" integer NOT NULL,
	"charges_updated_at" timestamp with time zone NOT NULL,
	"frozen_until" timestamp with time zone,
	"charge_cap_bonus" integer DEFAULT 0 NOT NULL,
	"daily_step" integer DEFAULT 0 NOT NULL,
	"daily_last_claim" date,
	CONSTRAINT "player_state_user_id_season_id_pk" PRIMARY KEY("user_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats_daily" (
	"user_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"date" date NOT NULL,
	"pixels" integer DEFAULT 0 NOT NULL,
	"coins_from_pixels" integer DEFAULT 0 NOT NULL,
	"bombs_triggered" integer DEFAULT 0 NOT NULL,
	"explosions_suffered" integer DEFAULT 0 NOT NULL,
	"self_explosions" integer DEFAULT 0 NOT NULL,
	"defused" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stats_daily_user_id_season_id_date_pk" PRIMARY KEY("user_id","season_id","date")
);
--> statement-breakpoint
CREATE TABLE "unlocked_colors" (
	"user_id" integer NOT NULL,
	"color_id" smallint NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unlocked_colors_user_id_color_id_pk" PRIMARY KEY("user_id","color_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"username" text NOT NULL,
	"avatar" text,
	"discord_created_at" timestamp with time zone NOT NULL,
	"banned_until" timestamp with time zone,
	"ban_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
ALTER TABLE "bombs" ADD CONSTRAINT "bombs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bombs" ADD CONSTRAINT "bombs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bombs" ADD CONSTRAINT "bombs_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_snapshots" ADD CONSTRAINT "chunk_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_config" ADD CONSTRAINT "game_config_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_log" ADD CONSTRAINT "mod_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_log" ADD CONSTRAINT "mod_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pixel_events" ADD CONSTRAINT "pixel_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pixel_events" ADD CONSTRAINT "pixel_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pixel_events" ADD CONSTRAINT "pixel_events_prev_user_id_users_id_fk" FOREIGN KEY ("prev_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_state" ADD CONSTRAINT "player_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_state" ADD CONSTRAINT "player_state_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_daily" ADD CONSTRAINT "stats_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_daily" ADD CONSTRAINT "stats_daily_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlocked_colors" ADD CONSTRAINT "unlocked_colors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bombs_active_cell_idx" ON "bombs" USING btree ("season_id","x","y") WHERE removed_at is null;--> statement-breakpoint
CREATE INDEX "bombs_owner_idx" ON "bombs" USING btree ("season_id","owner_id");--> statement-breakpoint
CREATE INDEX "chunk_snapshots_lookup_idx" ON "chunk_snapshots" USING btree ("season_id","cx","cy","id");--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pixel_events_user_idx" ON "pixel_events" USING btree ("season_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "pixel_events_cell_idx" ON "pixel_events" USING btree ("season_id","x","y","id");