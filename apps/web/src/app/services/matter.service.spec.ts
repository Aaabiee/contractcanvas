import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatterService, Matter } from './matter.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('MatterService', () => {
  let service: MatterService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api/matters';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        MatterService,
      ],
    });
    service = TestBed.inject(MatterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getMatters()', () => {
    it('fetches and returns an array of matters', () => {
      const mockMatters: Matter[] = [
        { id: 'm1', title: 'Matter 1', status: 'OPEN' },
        { id: 'm2', title: 'Matter 2', status: 'CLOSED' },
      ];

      service.getMatters().subscribe(matters => {
        expect(matters.length).toBe(2);
        expect(matters).toEqual(mockMatters);
      });

      const req = httpMock.expectOne(apiUrl);
      expect(req.request.method).toBe('GET');
      req.flush(mockMatters);
    });

    it('propagates HTTP errors to the subscriber', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getMatters().subscribe({ error: e => (error = e) });

      const req = httpMock.expectOne(apiUrl);
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      tick();

      expect(error).toBeDefined();
      expect(error!.status).toBe(403);
    }));
  });

  describe('getMatter()', () => {
    it('fetches a single matter by id', () => {
      const mockMatter: Matter = { id: 'm1', title: 'Matter 1', status: 'OPEN' };

      service.getMatter('m1').subscribe(matter => {
        expect(matter).toEqual(mockMatter);
      });

      const req = httpMock.expectOne(`${apiUrl}/m1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockMatter);
    });

    it('propagates 404 errors to the subscriber', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getMatter('missing').subscribe({ error: e => (error = e) });

      const req = httpMock.expectOne(`${apiUrl}/missing`);
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
      tick();

      expect(error!.status).toBe(404);
    }));
  });
});
