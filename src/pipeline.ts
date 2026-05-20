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

  // Detect segment type from first file
  const firstFile = segmentKeys[0].split("/").pop() ?? "";
  const isTs = firstFile.endsWith(".ts");
  const isM4s = firstFile.endsWith(".m4s");
  const isFmp4 = isM4s || firstFile.endsWith(".mp4") || firstFile.endsWith(".m4a");

  const videoPath = join(workDir, "output.mp4");

  if (isTs || isFmp4) {
    // TS or fMP4 segments: use ffmpeg concat demuxer
    const concatList = join(workDir, "concat.txt");
    const inputFiles = segmentKeys
      .filter((key) => {
        const name = key.split("/").pop() ?? "";
        // Skip init segment from concat list — it's referenced via EXT-X-MAP
        return !name.startsWith("init.");
      })
      .map((key) => join(workDir, key.split("/").pop() ?? key));

    // For fMP4: prepend init segment if it exists
    const initFile = segmentKeys.find((k) => (k.split("/").pop() ?? "").startsWith("init."));
    const allFiles = initFile
      ? [join(workDir, initFile.split("/").pop() ?? ""), ...inputFiles]
      : inputFiles;

    const listContent = allFiles.map((f) => `file '${f}'`).join("\n");
    await writeFile(concatList, listContent);

    log.info({ clipId, format: isTs ? "ts" : "fmp4" }, "Concatenating segments → MP4");
    await exec(
      "ffmpeg",
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
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
  } else {
    // WebM segments: byte-concatenate then convert (legacy path)
    const inputFiles = segmentKeys.map((key) => join(workDir, key.split("/").pop() ?? key));
    const mergedWebm = join(workDir, "merged.webm");
    const ws = createWriteStream(mergedWebm);
    for (const f of inputFiles) {
      await pipeline(createReadStream(f), ws, { end: false });
    }
    ws.end();
    await new Promise<void>((resolve) => ws.on("finish", resolve));

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
  }

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

  log.info(
    { clipId, duration, format: isTs ? "ts" : isFmp4 ? "fmp4" : "webm" },
    "Pipeline complete",
  );
  return { videoPath, thumbnailPath, duration };
}

export async function cleanup(clipId: string): Promise<void> {
  await rm(join("/tmp/clips", `clip-${clipId}`), { recursive: true, force: true }).catch(() => {});
  await storage.deletePrefix(`clips/${clipId}/segments/`).catch(() => {});
}
