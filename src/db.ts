import { eq } from "drizzle-orm";
import { boolean, index, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "";
const sql = postgres(DATABASE_URL, { max: 3 });
export const db = drizzle(sql);

export const clips = pgTable(
  "clips",
  {
    id: uuid("id").primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    matchId: text("match_id").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<"recording" | "processing" | "ready" | "failed">().notNull(),
    duration: real("duration"),
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    s3VideoKey: text("s3_video_key"),
    s3ThumbnailKey: text("s3_thumbnail_key"),
    errorMessage: text("error_message"),
    isPublic: boolean("is_public").notNull().default(false),
    shareId: text("share_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("clips_user_id_idx").on(table.userId),
    index("clips_status_idx").on(table.status),
  ],
);

export async function updateClipStatus(
  clipId: string,
  status: "ready" | "failed",
  data?: {
    videoUrl?: string;
    thumbnailUrl?: string;
    s3VideoKey?: string;
    s3ThumbnailKey?: string;
    duration?: number;
    errorMessage?: string;
  },
): Promise<void> {
  await db
    .update(clips)
    .set({ status, ...data, updatedAt: new Date() })
    .where(eq(clips.id, clipId));
}
