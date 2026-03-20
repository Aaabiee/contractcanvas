import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BillingService, CreateInvoicePayload, InvoiceIntent } from './billing.service';

function makeIntent(overrides: Partial<InvoiceIntent> = {}): InvoiceIntent {
  return {
    clientSecret: 'pi_secret_abc',
    invoiceId:    'inv-1',
    amountCents:  5000,
    currency:     'usd',
    ...overrides,
  };
}

describe('BillingService', () => {
  let service: BillingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BillingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('createInvoice()', () => {
    it('POSTs to /api/billing/invoice with the payload', () => {
      const payload: CreateInvoicePayload = { contractId: 'c1', amountCents: 5000 };
      service.createInvoice(payload).subscribe();
      const req = http.expectOne('/api/billing/invoice');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(makeIntent());
    });

    it('returns the InvoiceIntent from the server', () => {
      const intent = makeIntent({ invoiceId: 'inv-42', amountCents: 12000 });
      let result: InvoiceIntent | undefined;
      service.createInvoice({ contractId: 'c1', amountCents: 12000 }).subscribe(r => (result = r));
      http.expectOne('/api/billing/invoice').flush(intent);
      expect(result!.invoiceId).toBe('inv-42');
      expect(result!.amountCents).toBe(12000);
    });

    it('includes optional currency and dueAt fields in the POST body', () => {
      const payload: CreateInvoicePayload = {
        contractId:  'c1',
        amountCents: 5000,
        currency:    'eur',
        dueAt:       '2026-12-31T00:00:00.000Z',
      };
      service.createInvoice(payload).subscribe();
      const req = http.expectOne('/api/billing/invoice');
      expect(req.request.body.currency).toBe('eur');
      expect(req.request.body.dueAt).toBe('2026-12-31T00:00:00.000Z');
      req.flush(makeIntent({ currency: 'eur' }));
    });

    it('returns clientSecret for Stripe integration', () => {
      let result: InvoiceIntent | undefined;
      service.createInvoice({ contractId: 'c1', amountCents: 500 }).subscribe(r => (result = r));
      http.expectOne('/api/billing/invoice').flush(makeIntent({ clientSecret: 'pi_secret_xyz' }));
      expect(result!.clientSecret).toBe('pi_secret_xyz');
    });
  });
});
