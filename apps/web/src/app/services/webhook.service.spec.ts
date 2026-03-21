import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let service: WebhookService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WebhookService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => expect(service).toBeTruthy());

  it('list sends GET to correct URL', () => {
    service.list('org-1').subscribe(res => {
      expect(res.data).toHaveLength(1);
    });
    const req = httpMock.expectOne('/api/organizations/org-1/webhooks');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [{ id: 'wh-1', url: 'https://example.com', events: ['matter.created'], isActive: true }] });
  });

  it('create sends POST with url and events', () => {
    const payload = { url: 'https://hook.example.com', events: ['contract.created'] };
    service.create('org-1', payload).subscribe(res => {
      expect(res.secret).toBe('sec_abc');
    });
    const req = httpMock.expectOne('/api/organizations/org-1/webhooks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ id: 'wh-2', ...payload, isActive: true, secret: 'sec_abc', createdAt: new Date().toISOString() });
  });

  it('update sends PATCH with partial data', () => {
    service.update('org-1', 'wh-1', { isActive: false }).subscribe();
    const req = httpMock.expectOne('/api/organizations/org-1/webhooks/wh-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ id: 'wh-1', isActive: false });
  });

  it('remove sends DELETE', () => {
    service.remove('org-1', 'wh-1').subscribe();
    const req = httpMock.expectOne('/api/organizations/org-1/webhooks/wh-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deliveries sends GET for webhook deliveries', () => {
    service.deliveries('org-1', 'wh-1').subscribe(res => {
      expect(res.data).toHaveLength(0);
    });
    const req = httpMock.expectOne('/api/organizations/org-1/webhooks/wh-1/deliveries');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });
});
