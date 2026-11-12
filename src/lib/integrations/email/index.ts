import { ServerClient } from "postmark";

// Sending email through Postmark (decision #6). Mail goes out from the
// ArchiTrac address in EMAIL_FROM with the firm's name on it; replies go to
// the person who sent it. Tests swap in a recorder with setMailerForTests().

export type OutgoingEmail = {
  /** Display name on the From line (the firm). */
  fromName: string;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  text: string;
  attachments: { name: string; content: Uint8Array; contentType: string }[];
};

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export const EMAIL_NOT_SET_UP = "Email isn't set up yet (POSTMARK_SERVER_TOKEN and EMAIL_FROM), so the invoice can't be emailed.";

export class EmailNotConfigured extends Error {
  constructor() {
    super(EMAIL_NOT_SET_UP);
  }
}

/** The address part of EMAIL_FROM: `ArchiTrac <billing@x.com>` → `billing@x.com`. */
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

/** A From line with a display name, quoted so commas and dots are safe. */
export function fromLine(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

class PostmarkMailer implements Mailer {
  private client: ServerClient;
  constructor(
    token: string,
    private fromAddress: string,
  ) {
    this.client = new ServerClient(token);
  }

  async send(e: OutgoingEmail) {
    const r = await this.client.sendEmail({
      From: fromLine(e.fromName, this.fromAddress),
      To: e.to.join(", "),
      Cc: e.cc.length ? e.cc.join(", ") : undefined,
      ReplyTo: e.replyTo ?? undefined,
      Subject: e.subject,
      TextBody: e.text,
      MessageStream: "outbound",
      Attachments: e.attachments.map((a) => ({
        Name: a.name,
        Content: Buffer.from(a.content).toString("base64"),
        ContentType: a.contentType,
        ContentID: null,
      })),
    });
    return { messageId: r.MessageID };
  }
}

/** Records what would have been sent. For tests. */
export class RecordingMailer implements Mailer {
  sent: OutgoingEmail[] = [];
  failNext: Error | null = null;
  async send(e: OutgoingEmail) {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.sent.push(e);
    return { messageId: `test-${this.sent.length}` };
  }
}

let override: Mailer | null = null;
let postmark: PostmarkMailer | null = null;

export function setMailerForTests(m: Mailer | null) {
  override = m;
}

/** The mailer, or throws EmailNotConfigured when the Postmark settings are missing. */
export function mailer(): Mailer {
  if (override) return override;
  if (postmark) return postmark;
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM;
  if (!token || !from) throw new EmailNotConfigured();
  postmark = new PostmarkMailer(token, addressOf(from));
  return postmark;
}
