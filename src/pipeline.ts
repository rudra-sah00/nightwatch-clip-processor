import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { logger } from "./logger.js";
import { storage } from "./storage.js";

const exec = promisify(execFile);
const log = logger.child({ module: "pipeline" });

interface PipelineResult {
  videoPath: string;
  thumbnailPath: string;
  duration: number;
}

export async function processClip(clipId: string): Promise<PipelineResult> {
  const workDir = join("/tmp/clips", `clip-${clipId}`);
  await mkdir(workDir, { recursive: true });

  // Download segments from disk
  const segmentKeys = await storage.listKeys(`clips/${clipId}/segments/`);
  if (segmentKeys.length === 0) throw new Error("No recorded video found");

  log.info({ clipId, segments: segmentKeys.length }, "Downloading segments from disk");

  for (const key of segmentKeys) {
    const filename = key.split("/").pop() ?? key;
    await storage.downloadToFile(key, join(workDir, filename));
  }

  // Merge WebM chunks into single file
  const inputFiles = segmentKeys.map((key) => join(workDir, key.split("/").pop() ?? key));
  const mergedWebm = join(workDir, "merged.webm");
  const ws = createWriteStream(mergedWebm);
  for (const f of inputFiles) {
    await pipeline(createReadStream(f), ws, { end: false });
  }
  ws.end();
  await new Promise<void>((resolve) => ws.on("finish", resolve));

  const videoPath = join(workDir, "output.mp4");
  log.info({ clipId }, "Converting WebM → MP4");

  await exec(
    "ffmpeg",
    [
      "-i",
      mergedWebm,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-y",
      videoPath,
    ],
    { timeout: 300_000 },
  );

  const { stdout: probeOut } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = Number.parseFloat(probeOut.trim()) || 0;

  const thumbnailPath = join(workDir, "thumbnail.jpg");
  await exec(
    "ffmpeg",
    [
      "-ss",
      String(Math.max(0, duration / 2)),
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-q:v",
      "2",
      "-y",
      thumbnailPath,
    ],
    { timeout: 30_000 },
  );

  log.info({ clipId, duration }, "Pipeline complete");
  return { videoPath, thumbnailPath, duration };
}

export async function cleanup(clipId: string): Promise<void> {
  await rm(join("/tmp/clips", `clip-${clipId}`), { recursive: true, force: true }).catch(() => {});
  await storage.deletePrefix(`clips/${clipId}/segments/`).catch(() => {});
}
