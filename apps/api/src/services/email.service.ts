import * as postmark from 'postmark';

const ENV      = process.env.NODE_ENV ?? 'development';
const API_KEY  = process.env.POSTMARK_API_KEY ?? '';
const FROM     = process.env.EMAIL_FROM ?? 'noreply@contractcanvas.app';

let client: postmark.ServerClient | null = null;
if (ENV !== 'test' && API_KEY) {
  client = new postmark.ServerClient(API_KEY);
}

export interface SendEmailOpts {
  to:       string;
  subject:  string;
  htmlBody: string;
  textBody: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  if (ENV === 'test') return;

  if (!client) {
    console.log(`[email] DEV — To: ${opts.to} | Subject: ${opts.subject}`);
    return;
  }

  await client.sendEmail({
    From:     FROM,
    To:       opts.to,
    Subject:  opts.subject,
    HtmlBody: opts.htmlBody,
    TextBody: opts.textBody,
  });
}
