import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger.js";
import { minio } from "./minio.js";

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

  const segmentKeys = await minio.listKeys(`clips/${clipId}/segments/`);
  if (segmentKeys.length === 0) throw new Error("No recorded video found");

  log.info({ clipId, segments: segmentKeys.length }, "Downloading segments");

  for (const key of segmentKeys) {
    const filename = key.split("/").pop() ?? key;
    await minio.downloadToFile(key, join(workDir, filename));
  }

  const concatListPath = join(workDir, "concat.txt");
  const entries = segmentKeys.map((key) => {
    const filename = key.split("/").pop() ?? key;
    return `file '${join(workDir, filename)}'`;
  });
  await writeFile(concatListPath, entries.join("\n"));

  const videoPath = join(workDir, "output.mp4");
  log.info({ clipId }, "Converting WebM → MP4");

  // WebM chunks from MediaRecorder lack proper duration headers.
  // Use concat demuxer with fflags +genpts to regenerate timestamps.
  const inputFiles = segmentKeys.map((key) => join(workDir, key.split("/").pop() ?? key));
  const concatInput = `concat:${inputFiles.join("|")}`;

  await exec(
    "ffmpeg",
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-fflags",
      "+genpts",
      "-i",
      concatListPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-vsync",
      "cfr",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-af",
      "aresample=async=1000",
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
  await minio.deletePrefix(`clips/${clipId}/segments/`).catch(() => {});
}
