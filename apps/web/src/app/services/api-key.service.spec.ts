import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ApiKeyService } from './api-key.service';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiKeyService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => expect(service).toBeTruthy());

  it('list sends GET to correct URL', () => {
    service.list('org-1').subscribe(res => expect(res.data).toHaveLength(1));
    const req = httpMock.expectOne('/api/organizations/org-1/api-keys');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [{ id: 'k1', name: 'CI key', prefix: 'cc_live_abcd', lastUsedAt: null, createdAt: '2024-01-01' }] });
  });

  it('create sends POST with name and returns rawKey', () => {
    service.create('org-1', 'Deploy key').subscribe(res => {
      expect(res.rawKey).toBe('cc_live_full_key_here');
      expect(res.name).toBe('Deploy key');
    });
    const req = httpMock.expectOne('/api/organizations/org-1/api-keys');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Deploy key' });
    req.flush({ id: 'k2', name: 'Deploy key', prefix: 'cc_live_abcd', rawKey: 'cc_live_full_key_here', createdAt: '2024-01-01' });
  });

  it('revoke sends DELETE', () => {
    service.revoke('org-1', 'k1').subscribe();
    const req = httpMock.expectOne('/api/organizations/org-1/api-keys/k1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
