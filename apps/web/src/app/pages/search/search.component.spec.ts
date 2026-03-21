import 'zone.js/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SearchComponent } from './search.component';
import { SearchService, SearchResults } from '../../services/search.service';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { of, throwError } from 'rxjs';

const emptyResults: SearchResults = {
  q: 'test', total: 0, matters: [], contracts: [], documents: [],
};

const filledResults: SearchResults = {
  q:     'acme',
  total: 2,
  matters:   [{ id: 'm1', title: 'Acme Dispute', status: 'OPEN', createdAt: '2026-01-01' }],
  contracts: [{ id: 'ct1', title: 'Acme NDA', status: 'ACTIVE', matterId: 'm1', createdAt: '2026-01-01T00:00:00Z' }],
  documents: [],
};

describe('SearchComponent', () => {
  let fixture: ComponentFixture<SearchComponent>;
  let component: SearchComponent;
  let searchService: jest.Mocked<SearchService>;
  let queryParams$: Subject<Record<string, string>>;

  beforeEach(async () => {
    queryParams$ = new Subject();
    const searchMock = { search: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimations(),
        provideRouter([]),
        { provide: SearchService, useValue: searchMock },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParams$.asObservable() },
        },
      ],
    }).compileComponents();

    searchService = TestBed.inject(SearchService) as jest.Mocked<SearchService>;
    fixture       = TestBed.createComponent(SearchComponent);
    component     = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('starts with no results and no query', () => {
    expect(component.results()).toBeNull();
    expect(component.query()).toBe('');
  });

  it('loads results when queryParams emits q', fakeAsync(() => {
    searchService.search.mockReturnValue(of(filledResults));
    queryParams$.next({ q: 'acme' });
    tick();
    expect(searchService.search).toHaveBeenCalledWith('acme');
    expect(component.results()?.total).toBe(2);
    expect(component.loading()).toBe(false);
  }));

  it('sets query signal from queryParams', fakeAsync(() => {
    searchService.search.mockReturnValue(of(emptyResults));
    queryParams$.next({ q: 'test' });
    tick();
    expect(component.query()).toBe('test');
  }));

  it('ignores queryParams without q', fakeAsync(() => {
    queryParams$.next({});
    tick();
    expect(searchService.search).not.toHaveBeenCalled();
  }));

  it('handles search error gracefully', fakeAsync(() => {
    searchService.search.mockReturnValue(throwError(() => new Error('Network error')));
    queryParams$.next({ q: 'fail' });
    tick();
    expect(component.loading()).toBe(false);
    expect(component.results()).toBeNull();
  }));

  it('statusClass returns correct class for OPEN', () => {
    expect(component.statusClass('OPEN')).toBe('status-open');
  });

  it('statusClass converts ON_HOLD to status-on-hold', () => {
    expect(component.statusClass('ON_HOLD')).toBe('status-on-hold');
  });
});
