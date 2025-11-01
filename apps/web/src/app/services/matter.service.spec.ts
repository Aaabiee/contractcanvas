// apps/web/src/app/services/matter.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatterService, Matter } from './matter.service';

describe('MatterService', () => {
  let service: MatterService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api/matters';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClientTesting(), // Use modern provider
        MatterService
      ]
    });
    service = TestBed.inject(MatterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify(); // Make sure no requests are outstanding
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getMatters() should fetch and return an array of matters', () => {
    const mockMatters: Matter[] = [
      { id: 'm1', title: 'Matter 1', status: 'OPEN' },
      { id: 'm2', title: 'Matter 2', status: 'CLOSED' }
    ];

    service.getMatters().subscribe(matters => {
      expect(matters.length).toBe(2);
      expect(matters).toEqual(mockMatters);
    });

    const req = httpMock.expectOne(apiUrl);
    expect(req.request.method).toBe('GET');
    req.flush(mockMatters);
  });

  it('getMatter(id) should fetch a single matter', () => {
    const mockMatter: Matter = { id: 'm1', title: 'Matter 1', status: 'OPEN' };
    const matterId = 'm1';

    service.getMatter(matterId).subscribe(matter => {
      expect(matter).toEqual(mockMatter);
    });

    const req = httpMock.expectOne(`${apiUrl}/${matterId}`);
    expect(req.request.method).toBe('GET');
    req.flush(mockMatter);
  });
});