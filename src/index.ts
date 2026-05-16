import "dotenv/config";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { uploadThumbnail, uploadVideo } from "./cloudinary.js";
import { updateClipStatus } from "./db.js";
import { logger } from "./logger.js";
import { cleanup, processClip } from "./pipeline.js";

const exec = promisify(execFile);
const log = logger.child({ module: "clip-processor" });
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const clipQueue = new Queue("clip-processing", {
  connection: { url: REDIS_URL, maxRetriesPerRequest: null },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});

async function preflight(): Promise<void> {
  try {
    const { stdout } = await exec("ffmpeg", ["-version"]);
    log.info(`✅ FFmpeg: ${stdout.split("\n")[0]}`);
  } catch {
    log.fatal("❌ FFmpeg not found");
    process.exit(1);
  }

  const dir = "/tmp/clips";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const t = `${dir}/.health-${Date.now()}`;
  writeFileSync(t, "ok");
  unlinkSync(t);
  log.info("✅ /tmp/clips writable");

  await clipQueue.getJobCounts();
  log.info("✅ Redis connected");
}

function startWorker() {
  const publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker(
    "clip-processing",
    async (job) => {
      const { clipId, userId } = job.data as { clipId: string; userId: string };
      log.info({ clipId, jobId: job.id }, "Processing clip");

      try {
        const { videoPath, thumbnailPath, duration } = await processClip(clipId);

        const [videoUrl, thumbnailUrl] = await Promise.all([
          uploadVideo(videoPath, userId, clipId),
          uploadThumbnail(thumbnailPath, userId, clipId),
        ]);

        await updateClipStatus(clipId, "ready", {
          videoUrl,
          thumbnailUrl,
          s3VideoKey: `clips/${userId}/${clipId}`,
          s3ThumbnailKey: `clips/${userId}/${clipId}-thumb`,
          duration,
        });

        await publisher.publish(
          "clip:ready",
          JSON.stringify({ userId, clipId, thumbnailUrl, videoUrl, duration }),
        );

        log.info({ clipId, duration }, "Clip ready");
        await cleanup(clipId);
      } catch (err) {
        log.error({ clipId, err }, "Clip processing failed");
        await updateClipStatus(clipId, "failed", {
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
        throw err;
      }
    },
    { connection: { url: REDIS_URL, maxRetriesPerRequest: null }, concurrency: 2 },
  );

  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "Job failed"));
  return worker;
}

async function main() {
  log.info("Starting clip processor...");
  await preflight();
  const worker = startWorker();
  log.info("✅ Worker running");

  const shutdown = async () => {
    log.info("Shutting down...");
    await worker.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
