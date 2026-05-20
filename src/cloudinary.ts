import { createReadStream } from "node:fs";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function uploadVideo(
  filePath: string,
  userId: string,
  clipId: string,
): Promise<string> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `clips/${userId}`,
    public_id: clipId,
    resource_type: "video",
    overwrite: true,
  });
  return result.secure_url;
}

export async function uploadThumbnail(
  filePath: string,
  userId: string,
  clipId: string,
): Promise<string> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `clips/${userId}`,
    public_id: `${clipId}-thumb`,
    resource_type: "image",
    overwrite: true,
  });
  return result.secure_url;
}

export async function deleteClipAssets(userId: string, clipId: string): Promise<void> {
  await cloudinary.uploader
    .destroy(`clips/${userId}/${clipId}`, { resource_type: "video" })
    .catch(() => {});
  await cloudinary.uploader
    .destroy(`clips/${userId}/${clipId}-thumb`, { resource_type: "image" })
    .catch(() => {});
}
