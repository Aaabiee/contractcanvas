import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SearchService, SearchResults } from './search.service';

const mockResults: SearchResults = {
  q:         'acme',
  total:     1,
  matters:   [{ id: 'm1', title: 'Acme Dispute', status: 'OPEN', createdAt: new Date().toISOString() }],
  contracts: [],
  documents: [],
};

describe('SearchService', () => {
  let service: SearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SearchService);
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates successfully', () => expect(service).toBeTruthy());

  it('search sends GET /api/search with q param', () => {
    service.search('acme').subscribe(r => expect(r.total).toBe(1));
    const req = http.expectOne(r => r.url === '/api/search' && r.params.get('q') === 'acme');
    expect(req.request.method).toBe('GET');
    req.flush(mockResults);
  });

  it('search sends limit param', () => {
    service.search('test', 5).subscribe();
    const req = http.expectOne(r => r.params.get('limit') === '5');
    req.flush({ q: 'test', total: 0, matters: [], contracts: [], documents: [] });
  });

  it('search defaults limit to 10', () => {
    service.search('hello').subscribe();
    const req = http.expectOne(r => r.params.get('limit') === '10');
    req.flush({ q: 'hello', total: 0, matters: [], contracts: [], documents: [] });
  });
});
