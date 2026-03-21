import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';

export interface SignatureRecipient {
  email: string;
  name:  string;
  role:  string;
}

export interface CreateEnvelopeRequest {
  title:      string;
  message?:   string;
  recipients: SignatureRecipient[];
  documentUrl?: string;
  callbackUrl:  string;
}

export interface CreateEnvelopeResult {
  providerId: string;
  signingUrl?: string;
  status:      string;
}

export interface EnvelopeStatus {
  providerId: string;
  status:     string;
  recipients: Array<{ email: string; status: string; signedAt?: string }>;
  completedAt?: string;
  auditTrailUrl?: string;
}

export interface SignatureProvider {
  readonly name: string;
  createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult>;
  voidEnvelope(providerId: string, reason: string): Promise<void>;
  getStatus(providerId: string): Promise<EnvelopeStatus>;
  verifyWebhook(payload: string, signature: string): boolean;
}

class DocuSignProvider implements SignatureProvider {
  readonly name = 'docusign';
  private baseUrl: string;
  private accountId: string;
  private accessToken: string;

  constructor() {
    this.baseUrl     = process.env.DOCUSIGN_BASE_URL    || 'https://demo.docusign.net/restapi/v2.1';
    this.accountId   = process.env.DOCUSIGN_ACCOUNT_ID  || '';
    this.accessToken = process.env.DOCUSIGN_ACCESS_TOKEN || '';
  }

  async createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    const body = {
      emailSubject: req.title,
      emailBlurb:   req.message || `Please review and sign: ${req.title}`,
      status:       'sent',
      recipients: {
        signers: req.recipients.map((r, i) => ({
          email:          r.email,
          name:           r.name,
          recipientId:    String(i + 1),
          routingOrder:   String(i + 1),
          roleName:       r.role,
        })),
      },
      eventNotification: {
        url: req.callbackUrl,
        requireAcknowledgment: true,
        envelopeEvents: [
          { envelopeEventStatusCode: 'sent' },
          { envelopeEventStatusCode: 'delivered' },
          { envelopeEventStatusCode: 'completed' },
          { envelopeEventStatusCode: 'voided' },
          { envelopeEventStatusCode: 'declined' },
        ],
      },
    };

    const res = await fetch(`${this.baseUrl}/accounts/${this.accountId}/envelopes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text }, 'DocuSign createEnvelope failed');
      throw new Error('Failed to create DocuSign envelope');
    }

    const data = await res.json() as { envelopeId: string; status: string; uri: string };
    return { providerId: data.envelopeId, status: data.status };
  }

  async voidEnvelope(providerId: string, reason: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/accounts/${this.accountId}/envelopes/${providerId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ status: 'voided', voidedReason: reason }),
      },
    );
    if (!res.ok) {
      throw new Error('Failed to void DocuSign envelope');
    }
  }

  async getStatus(providerId: string): Promise<EnvelopeStatus> {
    const res = await fetch(
      `${this.baseUrl}/accounts/${this.accountId}/envelopes/${providerId}`,
      { headers: { 'Authorization': `Bearer ${this.accessToken}` } },
    );
    if (!res.ok) throw new Error('Failed to get DocuSign status');

    const data = await res.json() as any;
    return {
      providerId,
      status:        data.status,
      recipients:    [],
      completedAt:   data.completedDateTime || undefined,
      auditTrailUrl: undefined,
    };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    const secret = process.env.DOCUSIGN_WEBHOOK_SECRET;
    if (!secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}

class HelloSignProvider implements SignatureProvider {
  readonly name = 'hellosign';
  private apiKey: string;
  private baseUrl = 'https://api.hellosign.com/v3';

  constructor() {
    this.apiKey = process.env.HELLOSIGN_API_KEY || '';
  }

  async createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    const form = new URLSearchParams();
    form.set('title', req.title);
    form.set('subject', req.title);
    form.set('message', req.message || `Please review and sign: ${req.title}`);
    req.recipients.forEach((r, i) => {
      form.set(`signers[${i}][email_address]`, r.email);
      form.set(`signers[${i}][name]`, r.name);
      form.set(`signers[${i}][order]`, String(i));
    });

    const res = await fetch(`${this.baseUrl}/signature_request/send`, {
      method:  'POST',
      headers: { 'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}` },
      body:    form,
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text }, 'HelloSign createEnvelope failed');
      throw new Error('Failed to create HelloSign signature request');
    }

    const data = await res.json() as any;
    const sr = data.signature_request;
    return { providerId: sr.signature_request_id, status: 'sent' };
  }

  async voidEnvelope(providerId: string, _reason: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/signature_request/cancel/${providerId}`, {
      method:  'POST',
      headers: { 'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}` },
    });
    if (!res.ok) throw new Error('Failed to cancel HelloSign request');
  }

  async getStatus(providerId: string): Promise<EnvelopeStatus> {
    const res = await fetch(`${this.baseUrl}/signature_request/${providerId}`, {
      headers: { 'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}` },
    });
    if (!res.ok) throw new Error('Failed to get HelloSign status');

    const data = await res.json() as any;
    const sr = data.signature_request;
    return {
      providerId,
      status:     sr.is_complete ? 'completed' : (sr.is_declined ? 'declined' : 'sent'),
      recipients: (sr.signatures ?? []).map((s: any) => ({
        email:    s.signer_email_address,
        status:   s.status_code,
        signedAt: s.signed_at || undefined,
      })),
      completedAt: sr.is_complete ? sr.signing_url : undefined,
    };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    const secret = process.env.HELLOSIGN_WEBHOOK_SECRET;
    if (!secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}

class StubProvider implements SignatureProvider {
  readonly name = 'stub';

  async createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult> {
    const id = `stub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    logger.info({ providerId: id, recipients: req.recipients.length }, 'Stub: created envelope');
    return { providerId: id, status: 'sent', signingUrl: `https://stub.local/sign/${id}` };
  }

  async voidEnvelope(providerId: string, reason: string): Promise<void> {
    logger.info({ providerId, reason }, 'Stub: voided envelope');
  }

  async getStatus(providerId: string): Promise<EnvelopeStatus> {
    return { providerId, status: 'sent', recipients: [] };
  }

  verifyWebhook(): boolean {
    return true;
  }
}

const providers: Record<string, SignatureProvider> = {};

function buildProvider(name: string): SignatureProvider {
  switch (name) {
    case 'docusign':
      return process.env.DOCUSIGN_ACCESS_TOKEN ? new DocuSignProvider() : new StubProvider();
    case 'hellosign':
      return process.env.HELLOSIGN_API_KEY ? new HelloSignProvider() : new StubProvider();
    default:
      return new StubProvider();
  }
}

export function getProvider(name: string): SignatureProvider {
  if (!providers[name]) {
    providers[name] = buildProvider(name);
  }
  return providers[name];
}
