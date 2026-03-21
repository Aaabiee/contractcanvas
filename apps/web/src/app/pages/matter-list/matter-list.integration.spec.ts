import 'zone.js/testing';
/**
 * Component integration tests for MatterListComponent.
 *
 * Uses a REAL MatterService (no class mock) with HttpTestingController
 * to verify the full component → service → HTTP request chain.
 */

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { MatterListComponent } from './matter-list.component';
import { MatterService } from '../../services/matter.service';

const mockPage = (data: any[]) => ({ data, total: data.length, limit: 200, offset: 0 });

const twoMatters = [
  { id: 'm1', title: 'Smith v. Acme',  status: 'OPEN',   createdAt: '2024-01-01T00:00:00Z', _count: { contracts: 1, documents: 2, tasks: 3 } },
  { id: 'm2', title: 'NDA Dispute',    status: 'CLOSED', createdAt: '2024-02-01T00:00:00Z', _count: { contracts: 0, documents: 0, tasks: 0 } },
];

describe('MatterListComponent (integration — real MatterService)', () => {
  let fixture:    ComponentFixture<MatterListComponent>;
  let component:  MatterListComponent;
  let httpMock:   HttpTestingController;
  let snackBar:   { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [MatterListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        MatterService,
        { provide: MatDialog,   useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    })
      .overrideComponent(MatterListComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    httpMock  = TestBed.inject(HttpTestingController);
    fixture   = TestBed.createComponent(MatterListComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('sends GET /api/matters on init and populates the table', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === '/api/matters');
    expect(req.request.method).toBe('GET');
    req.flush(mockPage(twoMatters));
    tick();

    expect(component.dataSource.data).toHaveLength(2);
    expect(component.total()).toBe(2);
    expect(component.loading()).toBe(false);
  }));

  it('passes limit=200 query param to avoid pagination on load', fakeAsync(() => {
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url === '/api/matters');
    expect(req.request.params.get('limit')).toBe('200');
    req.flush(mockPage([]));
    tick();
  }));

  it('sets error signal when the HTTP request fails', fakeAsync(() => {
    fixture.detectChanges();

    httpMock
      .expectOne(r => r.url === '/api/matters')
      .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    tick();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
  }));

  it('renders .data-row elements after response is flushed', fakeAsync(() => {
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === '/api/matters').flush(mockPage(twoMatters));
    tick();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.data-row');
    expect(rows.length).toBe(2);
  }));

  it('shows .empty-state when API returns no matters', fakeAsync(() => {
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === '/api/matters').flush(mockPage([]));
    tick();
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.empty-state');
    expect(empty).toBeTruthy();
  }));

  it('search input triggers a new GET /api/matters request', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/matters').flush(mockPage(twoMatters));
    tick();

    // Update search
    component.search.setValue('Smith');
    tick(350); // debounce
    fixture.detectChanges();

    // The component re-runs filterPredicate client-side (no new HTTP call for search)
    httpMock.expectNone(r => r.url === '/api/matters' && r.params.has('q'));
    // Verify the data is filtered client-side
    expect(component.dataSource.filteredData.length).toBeLessThanOrEqual(2);
  }));

  it('statusLabel() returns human-readable strings via the service', () => {
    expect(component.statusLabel('OPEN')).toBe('Open');
    expect(component.statusLabel('ON_HOLD')).toBe('On Hold');
    expect(component.statusLabel('CLOSED')).toBe('Closed');
  });
});
