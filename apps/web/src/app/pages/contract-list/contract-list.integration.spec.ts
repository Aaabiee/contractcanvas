/**
 * Component integration tests for ContractListComponent.
 *
 * Uses REAL ContractService + MatterService with HttpTestingController.
 */

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { ContractListComponent } from './contract-list.component';
import { ContractService } from '../../services/contract.service';
import { MatterService } from '../../services/matter.service';

const contractPage = (data: any[]) => ({ data, total: data.length, limit: 200, offset: 0 });
const matterPage   = (data: any[]) => ({ data, total: data.length, limit: 100, offset: 0 });

const twoContracts = [
  { id: 'c1', title: 'NDA',  status: 'DRAFT',    createdAt: '2024-01-01T00:00:00Z',
    matter: { id: 'm1', title: 'Acme Matter' } },
  { id: 'c2', title: 'MSA',  status: 'EXECUTED',  createdAt: '2024-02-01T00:00:00Z',
    matter: { id: 'm1', title: 'Acme Matter' } },
];

describe('ContractListComponent (integration — real ContractService + MatterService)', () => {
  let fixture:   ComponentFixture<ContractListComponent>;
  let component: ContractListComponent;
  let httpMock:  HttpTestingController;
  let snackBar:  { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [ContractListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ContractService,
        MatterService,
        { provide: MatDialog,   useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    })
      .overrideComponent(ContractListComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    httpMock  = TestBed.inject(HttpTestingController);
    fixture   = TestBed.createComponent(ContractListComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('sends GET /api/contracts on init and populates the table', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === '/api/contracts');
    expect(req.request.method).toBe('GET');
    req.flush(contractPage(twoContracts));
    tick();

    expect(component.dataSource.data).toHaveLength(2);
    expect(component.total()).toBe(2);
    expect(component.loading()).toBe(false);
  }));

  it('passes limit=200 on load to get all contracts', fakeAsync(() => {
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url === '/api/contracts');
    expect(req.request.params.get('limit')).toBe('200');
    req.flush(contractPage([]));
    tick();
  }));

  it('sets error signal on HTTP failure', fakeAsync(() => {
    fixture.detectChanges();
    httpMock
      .expectOne(r => r.url === '/api/contracts')
      .flush('Error', { status: 500, statusText: 'Server Error' });
    tick();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
  }));

  it('renders .data-row elements after response is flushed', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/contracts').flush(contractPage(twoContracts));
    tick();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.data-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('NDA');
    expect(rows[1].textContent).toContain('MSA');
  }));

  it('shows .empty-state when API returns no contracts', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/contracts').flush(contractPage([]));
    tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.empty-state')).toBeTruthy();
  }));

  it('statusLabel returns human-readable labels', () => {
    expect(component.statusLabel('DRAFT')).toBe('Draft');
    expect(component.statusLabel('EXECUTED')).toBe('Executed');
    expect(component.statusLabel('PENDING_SIGNATURE')).toBe('Pending Sign.');
    expect(component.statusLabel('NEGOTIATION')).toBe('Negotiation');
    expect(component.statusLabel('ARCHIVED')).toBe('Archived');
  });

  it('formatValue returns em-dash when no valueCents', () => {
    expect(component.formatValue({ id: 'x', title: 'T', status: 'DRAFT' as const })).toBe('—');
  });

  it('formatValue returns formatted currency string', () => {
    const contract = { id: 'x', title: 'T', status: 'DRAFT' as const, valueCents: 200000, currency: 'USD' };
    expect(component.formatValue(contract)).toContain('2,000');
  });
});
