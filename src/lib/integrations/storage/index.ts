import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// File storage (Cloudflare R2, private bucket). Files are never public: the
// app checks permission, then hands out a link that expires in minutes.
// Tests swap in a memory store with setStorageForTests().

export interface FileStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A download link that stops working after `seconds`. */
  signedUrl(key: string, seconds: number, downloadName?: string): Promise<string>;
}

export const STORAGE_NOT_SET_UP =
  "File storage isn't set up yet (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET), so the PDF can't be saved.";

export class StorageNotConfigured extends Error {
  constructor() {
    super(STORAGE_NOT_SET_UP);
  }
}

class R2Store implements FileStore {
  private client: S3Client;
  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private bucket: string,
  ) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r.Body) throw new Error(`Empty file: ${key}`);
    return r.Body.transformToByteArray();
  }

  async signedUrl(key: string, seconds: number, downloadName?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: downloadName ? `inline; filename="${downloadName}"` : undefined,
      }),
      { expiresIn: seconds },
    );
  }
}

/** Keeps files in memory. For tests. */
export class MemoryStore implements FileStore {
  files = new Map<string, { body: Uint8Array; contentType: string }>();
  failNext: Error | null = null;
  async put(key: string, body: Uint8Array, contentType: string) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.files.set(key, { body, contentType });
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error(`No such file: ${key}`);
    return f.body;
  }
  async signedUrl(key: string, seconds: number) {
    return `memory://${key}?expires=${seconds}`;
  }
}

let override: FileStore | null = null;
let r2: R2Store | null = null;

export function setStorageForTests(store: FileStore | null) {
  override = store;
}

/** The file store, or throws StorageNotConfigured when the R2 settings are missing. */
export function storage(): FileStore {
  if (override) return override;
  if (r2) return r2;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) throw new StorageNotConfigured();
  r2 = new R2Store(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET);
  return r2;
}
