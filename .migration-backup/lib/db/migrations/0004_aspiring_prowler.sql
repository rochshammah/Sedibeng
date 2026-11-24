-- Phase 4: donor goods, structured locations and service areas, item photos.
-- Existing data is preserved: new columns are nullable or defaulted, and existing rows
-- are mapped onto the new location/category structure below.
-- Also fixes a bug: the old check (quantity > 0) rejected offering ALL of a listing's quantity.
CREATE TYPE "public"."item_category_group" AS ENUM('SHOES', 'UNIFORMS', 'BAGS', 'BOOKS_STATIONERY', 'LEARNING_MATERIALS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('NONE', 'PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"service_area_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "donor_inventory" DROP CONSTRAINT "donor_inventory_quantity_positive";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_service_area_id" uuid;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "category_group" "item_category_group" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD COLUMN "category_group" "item_category_group" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD COLUMN "photo_object_key" text;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD COLUMN "photo_content_type" text;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD COLUMN "photo_status" "photo_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_name_uidx" ON "locations" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "locations_service_area_idx" ON "locations" USING btree ("service_area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_areas_name_uidx" ON "service_areas" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_service_area_id_service_areas_id_fk" FOREIGN KEY ("preferred_service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD CONSTRAINT "donor_inventory_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "donor_inventory_discovery_idx" ON "donor_inventory" USING btree ("status","location_id","category_group");--> statement-breakpoint
ALTER TABLE "donor_inventory" ADD CONSTRAINT "donor_inventory_quantity_positive" CHECK ("donor_inventory"."quantity_available" >= 0);--> statement-breakpoint
-- Pilot service areas and locations (administrators can correct and expand these later).
INSERT INTO "service_areas" ("name", "sort_order") VALUES
  ('Greater Gaborone', 10), ('Francistown', 20), ('Maun', 30), ('Palapye', 40), ('Kasane', 50)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "locations" ("name", "service_area_id", "sort_order")
SELECT v.name, sa.id, v.ord
FROM (VALUES
  ('Gaborone', 'Greater Gaborone', 10), ('Mogoditshane', 'Greater Gaborone', 20), ('Tlokweng', 'Greater Gaborone', 30),
  ('Mmopane', 'Greater Gaborone', 40), ('Gabane', 'Greater Gaborone', 50), ('Metsimotlhabe', 'Greater Gaborone', 60),
  ('Francistown', 'Francistown', 10), ('Maun', 'Maun', 10), ('Palapye', 'Palapye', 10), ('Kasane', 'Kasane', 10)
) AS v(name, area, ord)
JOIN "service_areas" sa ON lower(sa.name) = lower(v.area)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Category groups for existing rows (same rules the API uses for new rows).
UPDATE "assistance_requests" SET "category_group" = (CASE
  WHEN lower("category") LIKE '%shoe%' THEN 'SHOES'
  WHEN lower("category") LIKE '%uniform%' THEN 'UNIFORMS'
  WHEN lower("category") LIKE '%bag%' THEN 'BAGS'
  WHEN lower("category") ~ '(stationery|exercise|textbook|book)' THEN 'BOOKS_STATIONERY'
  WHEN lower("category") ~ '(learning|material)' THEN 'LEARNING_MATERIALS'
  ELSE 'OTHER' END)::"item_category_group";--> statement-breakpoint
UPDATE "donor_inventory" SET "category_group" = (CASE
  WHEN lower("category") LIKE '%shoe%' THEN 'SHOES'
  WHEN lower("category") LIKE '%uniform%' THEN 'UNIFORMS'
  WHEN lower("category") LIKE '%bag%' THEN 'BAGS'
  WHEN lower("category") ~ '(stationery|exercise|textbook|book)' THEN 'BOOKS_STATIONERY'
  WHEN lower("category") ~ '(learning|material)' THEN 'LEARNING_MATERIALS'
  ELSE 'OTHER' END)::"item_category_group";--> statement-breakpoint
-- Map existing schools, requests and listings onto locations (area text first, then district).
UPDATE "schools" s SET "location_id" = l.id FROM "locations" l
  WHERE s."location_id" IS NULL AND lower(coalesce(s."area", '')) = lower(l.name);--> statement-breakpoint
UPDATE "schools" s SET "location_id" = l.id FROM "locations" l
  WHERE s."location_id" IS NULL AND lower(s."district") = lower(l.name);--> statement-breakpoint
UPDATE "assistance_requests" r SET "location_id" = s."location_id" FROM "schools" s
  WHERE r."school_id" = s.id AND r."location_id" IS NULL AND s."location_id" IS NOT NULL;--> statement-breakpoint
UPDATE "donor_inventory" i SET "location_id" = l.id FROM "locations" l
  WHERE i."location_id" IS NULL AND lower(coalesce(i."area", '')) = lower(l.name);--> statement-breakpoint
UPDATE "donor_inventory" i SET "location_id" = l.id FROM "locations" l
  WHERE i."location_id" IS NULL AND lower(i."district") = lower(l.name);
