import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const client = new S3Client({
  region: process.env.MINIO_REGION || "us-east-1",
  endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretAccessKey: process.env.MINIO_SECRET_KEY || "minioadmin",
  },
});

const BUCKET = process.env.MINIO_CLIPS_BUCKET || "nightwatch-clips";

export const minio = {
  async upload(key: string, filePath: string, contentType: string): Promise<string> {
    const fileSize = (await stat(filePath)).size;
    await new Upload({
      client,
      params: {
        Bucket: BUCKET,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
        ContentLength: fileSize,
      },
    }).done();
    const endpoint = process.env.MINIO_ENDPOINT || "http://localhost:9000";
    return `${endpoint}/${BUCKET}/${key}`;
  },

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    await pipeline(res.Body as Readable, createWriteStream(destPath));
  },

  async listKeys(prefix: string): Promise<string[]> {
    const res = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    return (res.Contents || [])
      .map((o) => o.Key ?? "")
      .filter(Boolean)
      .sort();
  },

  async deletePrefix(prefix: string): Promise<void> {
    const keys = await this.listKeys(prefix);
    await Promise.all(
      keys.map((k) => client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }))),
    );
  },
};
