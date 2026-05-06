# Nightwatch Clip Processor

Standalone FFmpeg-based clip processing worker for Nightwatch livestream clipping.

## Architecture

This is a **plugin-style microservice** that connects to the same Redis and Postgres as the main backend. It listens on the `clip-processing` BullMQ queue and:

1. Downloads recorded WebM segments from MinIO
2. Concatenates and transcodes to MP4 via FFmpeg
3. Generates a thumbnail
4. Uploads final assets to MinIO
5. Updates clip status in Postgres
6. Publishes `clip:ready` event via Redis pub/sub

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_CLIPS_BUCKET=nightwatch-clips
LOG_LEVEL=info
```

## Development

```bash
pnpm install
pnpm dev
```

## Docker

```bash
docker build -t nightwatch-clip-processor .
docker run --env-file .env nightwatch-clip-processor
```

## Integration with Backend

The main `nightwatch-backend` enqueues jobs to the `clip-processing` BullMQ queue. This worker picks them up independently. No code coupling — only shared Redis queue and Postgres DB.
