CREATE TABLE "stats_hourly" (
	"season_id" integer NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"pixels" integer DEFAULT 0 NOT NULL,
	"explosions" integer DEFAULT 0 NOT NULL,
	"defuses" integer DEFAULT 0 NOT NULL,
	"online_peak" integer DEFAULT 0 NOT NULL,
	"minted_pixels" integer DEFAULT 0 NOT NULL,
	"minted_daily" integer DEFAULT 0 NOT NULL,
	"minted_bomb_bonus" integer DEFAULT 0 NOT NULL,
	"minted_defuse" integer DEFAULT 0 NOT NULL,
	"minted_admin" integer DEFAULT 0 NOT NULL,
	"spent_bomb" integer DEFAULT 0 NOT NULL,
	"spent_detector" integer DEFAULT 0 NOT NULL,
	"spent_defuser" integer DEFAULT 0 NOT NULL,
	"spent_color" integer DEFAULT 0 NOT NULL,
	"spent_boost" integer DEFAULT 0 NOT NULL,
	"spent_penalty" integer DEFAULT 0 NOT NULL,
	"spent_admin" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stats_hourly_season_id_hour_pk" PRIMARY KEY("season_id","hour")
);
--> statement-breakpoint
ALTER TABLE "stats_hourly" ADD CONSTRAINT "stats_hourly_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pixel_events_time_idx" ON "pixel_events" USING btree ("season_id","created_at");