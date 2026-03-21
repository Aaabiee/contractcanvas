import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuditLogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getLogs sends GET with org ID and params', () => {
    service.getLogs('org-1', { entity: 'Matter', limit: 25, offset: 0 }).subscribe(res => {
      expect(res.data).toHaveLength(1);
      expect(res.total).toBe(1);
    });

    const req = httpMock.expectOne(r =>
      r.url === '/api/organizations/org-1/audit-logs' &&
      r.params.get('entity') === 'Matter' &&
      r.params.get('limit') === '25'
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [{ id: 'log-1', entity: 'Matter', action: 'CREATE' }], total: 1, limit: 25, offset: 0 });
  });

  it('getLogs works with no optional params', () => {
    service.getLogs('org-2').subscribe();
    const req = httpMock.expectOne('/api/organizations/org-2/audit-logs');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it('exportCsv sends GET and returns blob', () => {
    service.exportCsv('org-1').subscribe(blob => {
      expect(blob).toBeInstanceOf(Blob);
    });

    const req = httpMock.expectOne('/api/organizations/org-1/audit-logs/export.csv');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['id,action\n']));
  });
});
