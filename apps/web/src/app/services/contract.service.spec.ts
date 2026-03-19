import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ContractService, Contract, ContractVersion } from './contract.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('ContractService', () => {
  let service: ContractService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api/contracts';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ContractService,
      ],
    });
    service = TestBed.inject(ContractService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getContracts()', () => {
    const mockContracts: Contract[] = [
      { id: 'c1', title: 'NDA', status: 'DRAFT' },
      { id: 'c2', title: 'MSA', status: 'EXECUTED' },
    ];

    it('fetches all contracts without filter', () => {
      service.getContracts().subscribe(contracts => {
        expect(contracts).toEqual(mockContracts);
      });
      const req = httpMock.expectOne(r => r.url === apiUrl);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('matterId')).toBe(false);
      req.flush(mockContracts);
    });

    it('passes matterId as query param', () => {
      service.getContracts('m1').subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('matterId') === 'm1');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('propagates HTTP errors', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getContracts().subscribe({ error: e => (error = e) });
      httpMock.expectOne(r => r.url === apiUrl).flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      tick();
      expect(error!.status).toBe(403);
    }));
  });

  describe('getContract()', () => {
    it('fetches a single contract', () => {
      const mock: Contract = { id: 'c1', title: 'NDA', status: 'DRAFT' };
      service.getContract('c1').subscribe(c => expect(c).toEqual(mock));
      const req = httpMock.expectOne(`${apiUrl}/c1`);
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('propagates 404', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getContract('missing').subscribe({ error: e => (error = e) });
      httpMock.expectOne(`${apiUrl}/missing`).flush('Not Found', { status: 404, statusText: 'Not Found' });
      tick();
      expect(error!.status).toBe(404);
    }));
  });

  describe('createContract()', () => {
    it('POSTs and returns created contract', () => {
      const created: Contract = { id: 'c3', title: 'New Contract', status: 'DRAFT' };
      service.createContract({ title: 'New Contract' }).subscribe(c => expect(c).toEqual(created));
      const req = httpMock.expectOne(apiUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ title: 'New Contract' });
      req.flush(created);
    });
  });

  describe('updateContract()', () => {
    it('PATCHes and returns updated contract', () => {
      const updated: Contract = { id: 'c1', title: 'Updated', status: 'NEGOTIATION' };
      service.updateContract('c1', { status: 'NEGOTIATION' }).subscribe(c => expect(c).toEqual(updated));
      const req = httpMock.expectOne(`${apiUrl}/c1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'NEGOTIATION' });
      req.flush(updated);
    });
  });

  describe('deleteContract()', () => {
    it('sends DELETE request', () => {
      let called = false;
      service.deleteContract('c1').subscribe(() => (called = true));
      const req = httpMock.expectOne(`${apiUrl}/c1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      expect(called).toBe(true);
    });
  });

  describe('getVersions()', () => {
    it('fetches versions for a contract', () => {
      const versions: ContractVersion[] = [
        { id: 'v1', contractId: 'c1', versionNumber: 1, storageKey: 'k1', mimeType: 'application/pdf', sizeBytes: 1024 },
      ];
      service.getVersions('c1').subscribe(v => expect(v).toEqual(versions));
      const req = httpMock.expectOne(`${apiUrl}/c1/versions`);
      expect(req.request.method).toBe('GET');
      req.flush(versions);
    });
  });

  describe('addVersion()', () => {
    it('POSTs a new version', () => {
      const version: ContractVersion = {
        id: 'v2', contractId: 'c1', versionNumber: 2, storageKey: 'k2', mimeType: 'application/pdf', sizeBytes: 2048,
      };
      service.addVersion('c1', { storageKey: 'k2', mimeType: 'application/pdf', sizeBytes: 2048 })
        .subscribe(v => expect(v).toEqual(version));
      const req = httpMock.expectOne(`${apiUrl}/c1/versions`);
      expect(req.request.method).toBe('POST');
      req.flush(version);
    });
  });
});
