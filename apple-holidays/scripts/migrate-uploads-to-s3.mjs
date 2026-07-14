/**
 * One-time migration: copy every file under public/uploads/ into the S3 bucket
 * at key `uploads/<relative-path>`, matching the scheme served by
 * /api/uploads/[...path]. Safe to re-run — it skips objects already present
 * with the same size. It never deletes anything (local or remote).
 *
 * Run this ON THE GCP SERVER (where the existing image files live):
 *   S3_BUCKET=ops.aahaas \
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_DEFAULT_REGION=ap-southeast-1 \
 *   node scripts/migrate-uploads-to-s3.mjs
 *
 * (If your .env already has these vars, you can instead do:
 *   node -r dotenv/config scripts/migrate-uploads-to-s3.mjs )
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'

const BUCKET = process.env.S3_BUCKET || 'ops.aahaas'
const REGION = process.env.S3_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-1'
const ROOT = path.join(process.cwd(), 'public', 'uploads')
const KEY_PREFIX = 'uploads'

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const s3 = new S3Client({
  region: REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

async function* walk(dir) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) }
  catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile()) yield full
  }
}

async function existsSameSize(key, size) {
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return h.ContentLength === size
  } catch { return false }
}

let uploaded = 0, skipped = 0, failed = 0
console.log(`Migrating ${ROOT} → s3://${BUCKET}/${KEY_PREFIX}/ (region ${REGION})`)

for await (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const key = `${KEY_PREFIX}/${rel}`
  const ext = rel.split('.').pop()?.toLowerCase() ?? ''
  try {
    const { size } = await stat(file)
    if (await existsSameSize(key, size)) { skipped++; continue }
    const body = await readFile(file)
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body,
      ContentType: MIME[ext] ?? 'application/octet-stream',
    }))
    uploaded++
    if (uploaded % 25 === 0) console.log(`  …${uploaded} uploaded`)
  } catch (err) {
    failed++
    console.error(`  FAILED ${rel}:`, err.name || err.message)
  }
}

console.log(`\nDone. uploaded=${uploaded} skipped(existing)=${skipped} failed=${failed}`)
