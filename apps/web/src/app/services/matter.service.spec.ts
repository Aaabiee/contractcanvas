import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatterService, Matter, MatterPage } from './matter.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('MatterService', () => {
  let service: MatterService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api/matters';

  const mockPage: MatterPage = {
    data:   [{ id: 'm1', title: 'Matter 1', status: 'OPEN' }, { id: 'm2', title: 'Matter 2', status: 'CLOSED' }],
    total:  2,
    limit:  50,
    offset: 0,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), MatterService],
    });
    service  = TestBed.inject(MatterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => expect(service).toBeTruthy());

  describe('getMatters()', () => {
    it('fetches and returns a paginated matters page', () => {
      service.getMatters().subscribe(page => {
        expect(page.data.length).toBe(2);
        expect(page.total).toBe(2);
      });
      const req = httpMock.expectOne(r => r.url === apiUrl);
      expect(req.request.method).toBe('GET');
      req.flush(mockPage);
    });

    it('passes status filter as query param', () => {
      service.getMatters({ status: 'OPEN' }).subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('status') === 'OPEN');
      expect(req.request.method).toBe('GET');
      req.flush({ data: [], total: 0, limit: 50, offset: 0 });
    });

    it('passes limit and offset as query params', () => {
      service.getMatters({ limit: 10, offset: 20 }).subscribe();
      const req = httpMock.expectOne(r =>
        r.url === apiUrl && r.params.get('limit') === '10' && r.params.get('offset') === '20'
      );
      req.flush({ data: [], total: 0, limit: 10, offset: 20 });
    });

    it('propagates HTTP errors to the subscriber', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getMatters().subscribe({ error: e => (error = e) });
      httpMock.expectOne(r => r.url === apiUrl).flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      tick();
      expect(error).toBeDefined();
      expect(error!.status).toBe(403);
    }));
  });

  describe('getMatter()', () => {
    it('fetches a single matter by id', () => {
      const mockMatter: Matter = { id: 'm1', title: 'Matter 1', status: 'OPEN' };
      service.getMatter('m1').subscribe(m => expect(m).toEqual(mockMatter));
      const req = httpMock.expectOne(`${apiUrl}/m1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockMatter);
    });

    it('propagates 404 errors', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getMatter('missing').subscribe({ error: e => (error = e) });
      httpMock.expectOne(`${apiUrl}/missing`).flush('Not Found', { status: 404, statusText: 'Not Found' });
      tick();
      expect(error!.status).toBe(404);
    }));
  });

  describe('createMatter()', () => {
    it('POSTs and returns created matter', () => {
      const created: Matter = { id: 'm3', title: 'New Matter', status: 'OPEN' };
      service.createMatter({ title: 'New Matter' }).subscribe(m => expect(m).toEqual(created));
      const req = httpMock.expectOne(apiUrl);
      expect(req.request.method).toBe('POST');
      req.flush(created);
    });
  });

  describe('updateMatter()', () => {
    it('PATCHes and returns updated matter', () => {
      const updated: Matter = { id: 'm1', title: 'Updated', status: 'CLOSED' };
      service.updateMatter('m1', { status: 'CLOSED' }).subscribe(m => expect(m).toEqual(updated));
      const req = httpMock.expectOne(`${apiUrl}/m1`);
      expect(req.request.method).toBe('PATCH');
      req.flush(updated);
    });
  });

  describe('deleteMatter()', () => {
    it('sends DELETE request', () => {
      let called = false;
      service.deleteMatter('m1').subscribe(() => (called = true));
      const req = httpMock.expectOne(`${apiUrl}/m1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      expect(called).toBe(true);
    });
  });
});
