import 'zone.js/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import { ContractListComponent, NewContractDialogComponent } from './contract-list.component';
import { ContractService, Contract, ContractPage } from '../../services/contract.service';
import { MatterService, Matter } from '../../services/matter.service';
import { MatDialogRef } from '@angular/material/dialog';

const mockContracts: Contract[] = [
  { id: 'c1', title: 'NDA',  status: 'DRAFT'    },
  { id: 'c2', title: 'MSA',  status: 'EXECUTED'  },
];
const mockPage = (data: Contract[]): ContractPage => ({ data, total: data.length, limit: 200, offset: 0 });

class MockContractService {
  getContracts   = jest.fn(() => of(mockPage(mockContracts)));
  createContract = jest.fn();
  deleteContract = jest.fn();
}

class MockMatterService {
  getMatters = jest.fn(() => of({ data: [], total: 0, limit: 100, offset: 0 }));
}

describe('ContractListComponent', () => {
  let component: ContractListComponent;
  let fixture: ComponentFixture<ContractListComponent>;
  let contractService: MockContractService;
  let snackBar: { open: jest.Mock };
  let dialogMock: { open: jest.Mock };

  beforeEach(async () => {
    snackBar   = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };
    dialogMock = { open: jest.fn(() => ({ afterClosed: () => of(null) })) };

    await TestBed.configureTestingModule({
      imports: [ContractListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ContractService, useClass: MockContractService },
        { provide: MatterService,   useClass: MockMatterService   },
      ],
    })
      .overrideComponent(ContractListComponent, {
        add: {
          providers: [
            { provide: MatDialog,   useValue: dialogMock },
            { provide: MatSnackBar, useValue: snackBar },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ContractListComponent);
    component = fixture.componentInstance;
    contractService = TestBed.inject(ContractService) as unknown as MockContractService;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('calls getContracts on init', () => {
    fixture.detectChanges();
    expect(contractService.getContracts).toHaveBeenCalled();
  });

  it('populates dataSource and total from page', () => {
    fixture.detectChanges();
    expect(component.dataSource.data).toHaveLength(2);
    expect(component.total()).toBe(2);
  });

  it('renders contract rows in the table', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.data-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('NDA');
    expect(rows[1].textContent).toContain('MSA');
  });

  it('shows empty state when no contracts', () => {
    contractService.getContracts.mockReturnValue(of(mockPage([])));
    fixture.detectChanges();
    const empty = fixture.nativeElement.querySelector('.empty-state');
    expect(empty).toBeTruthy();
  });

  it('sets error signal when getContracts fails', () => {
    const subject = new Subject<ContractPage>();
    contractService.getContracts.mockReturnValue(subject.asObservable());
    fixture.detectChanges();
    subject.error(new Error('network'));
    fixture.detectChanges();
    expect(component.error()).toBe('Failed to load contracts. Please try again.');
  });

  it('statusLabel returns readable labels', () => {
    expect(component.statusLabel('DRAFT')).toBe('Draft');
    expect(component.statusLabel('EXECUTED')).toBe('Executed');
    expect(component.statusLabel('PENDING_SIGNATURE')).toBe('Pending Sign.');
  });

  it('formatValue returns formatted currency', () => {
    const c = { id: 'x', title: 'T', status: 'DRAFT' as const, valueCents: 150000, currency: 'USD' };
    expect(component.formatValue(c)).toContain('1,500');
  });

  it('formatValue returns em-dash when no value', () => {
    const c = { id: 'x', title: 'T', status: 'DRAFT' as const };
    expect(component.formatValue(c)).toBe('—');
  });

  it('search valueChanges applies filter to dataSource (lines 182-184)', fakeAsync(() => {
    fixture.detectChanges();
    component.search.setValue('nda');
    tick(300);
    expect(component.dataSource.filter).toBe('nda');
  }));

  it('statusFilter valueChanges triggers load (lines 186-188)', fakeAsync(() => {
    fixture.detectChanges();
    contractService.getContracts.mockClear();
    component.statusFilter.setValue('EXECUTED');
    tick(50);
    expect(contractService.getContracts).toHaveBeenCalled();
  }));

  it('load passes status filter to getContracts (lines 203-216)', () => {
    fixture.detectChanges();
    contractService.getContracts.mockClear();
    component.statusFilter.setValue('DRAFT', { emitEvent: false });
    component.load();
    expect(contractService.getContracts).toHaveBeenCalledWith(undefined, expect.objectContaining({ status: 'DRAFT' }));
  });

  it('load passes undefined status when ALL is selected', () => {
    fixture.detectChanges();
    contractService.getContracts.mockClear();
    component.statusFilter.setValue('ALL', { emitEvent: false });
    component.load();
    expect(contractService.getContracts).toHaveBeenCalledWith(undefined, expect.objectContaining({ status: undefined }));
  });

  it('ngAfterViewInit sets filterPredicate that matches title and matter.title (lines 198-200)', () => {
    fixture.detectChanges();
    component.ngAfterViewInit();
    const pred = component.dataSource.filterPredicate;
    const row = { id: 'c1', title: 'NDA', status: 'DRAFT', matter: { title: 'Smith v. Acme' } } as any;
    expect(pred(row, 'nda')).toBe(true);
    expect(pred(row, 'smith')).toBe(true);
    expect(pred(row, 'zzz')).toBe(false);
  });

  it('openCreate creates contract and updates dataSource on success (lines 219-234)', fakeAsync(() => {
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    const newContract = { id: 'c3', title: 'New NDA', status: 'DRAFT' };
    dialogMock.open.mockReturnValue({ afterClosed: () => of({ title: 'New NDA', matterId: 'm1' }) });
    contractService.createContract.mockReturnValue(of(newContract));
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });

    component.openCreate();
    tick();

    expect(contractService.createContract).toHaveBeenCalledWith({ title: 'New NDA', matterId: 'm1' });
    expect(component.dataSource.data[0]).toEqual(newContract);
    expect(component.total()).toBe(3); // original 2 + 1
    // onAction fires, so navigate should be called
    expect(navSpy).toHaveBeenCalledWith(['/contracts', 'c3']);
  }));

  it('openCreate does nothing when dialog is cancelled', fakeAsync(() => {
    fixture.detectChanges();
    dialogMock.open.mockReturnValue({ afterClosed: () => of(undefined) });

    component.openCreate();
    tick();

    expect(contractService.createContract).not.toHaveBeenCalled();
  }));

  it('openCreate shows error snackbar when createContract fails (lines 231-232)', fakeAsync(() => {
    fixture.detectChanges();
    dialogMock.open.mockReturnValue({ afterClosed: () => of({ title: 'Bad', matterId: 'm1' }) });
    contractService.createContract.mockReturnValue(throwError(() => ({ error: { message: 'Duplicate title' } })));

    component.openCreate();
    tick();

    expect(snackBar.open).toHaveBeenCalledWith('Duplicate title', 'Dismiss', expect.any(Object));
  }));

  it('confirmDelete removes contract from dataSource on success (lines 237-249)', fakeAsync(() => {
    fixture.detectChanges();
    contractService.deleteContract.mockReturnValue(of(undefined));

    const event = { stopPropagation: jest.fn() } as any;
    component.confirmDelete(mockContracts[0], event);
    tick();

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(contractService.deleteContract).toHaveBeenCalledWith('c1');
    expect(component.dataSource.data.find((c: Contract) => c.id === 'c1')).toBeUndefined();
    expect(component.total()).toBe(1);
  }));

  it('confirmDelete shows error snackbar on failure (line 247)', fakeAsync(() => {
    fixture.detectChanges();
    contractService.deleteContract.mockReturnValue(throwError(() => new Error('fail')));

    const event = { stopPropagation: jest.fn() } as any;
    component.confirmDelete(mockContracts[0], event);
    tick();

    expect(snackBar.open).toHaveBeenCalledWith('Failed to delete contract.', 'Dismiss', expect.any(Object));
  }));

  it('goTo navigates to the contract detail page (lines 252-254)', () => {
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigate');
    component.goTo(mockContracts[0]);
    expect(navSpy).toHaveBeenCalledWith(['/contracts', 'c1']);
  });

  it('statusLabel returns raw string for unknown statuses (line 269)', () => {
    expect(component.statusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('route queryParams with create=1 triggers openCreate after delay (lines 190-192)', fakeAsync(() => {
    // Reset and recreate with queryParams containing create=1
    const localDialog = { open: jest.fn(() => ({ afterClosed: () => of(null) })) };
    const localSnack  = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ContractListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ContractService, useClass: MockContractService },
        { provide: MatterService,   useClass: MockMatterService   },
        { provide: ActivatedRoute, useValue: { queryParams: of({ create: '1' }) } },
      ],
    })
      .overrideComponent(ContractListComponent, {
        add: {
          providers: [
            { provide: MatDialog,   useValue: localDialog },
            { provide: MatSnackBar, useValue: localSnack },
          ],
        },
      })
      .compileComponents();

    const f = TestBed.createComponent(ContractListComponent);
    f.detectChanges();
    tick(200);
    expect(localDialog.open).toHaveBeenCalled();
  }));
});

describe('NewContractDialogComponent', () => {
  let component: NewContractDialogComponent;
  let fixture: ComponentFixture<NewContractDialogComponent>;
  let matterService: MockMatterService;
  let dialogRef: { close: jest.Mock };

  beforeEach(async () => {
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewContractDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatterService,   useClass: MockMatterService },
        { provide: MatDialogRef,    useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewContractDialogComponent);
    component = fixture.componentInstance;
    matterService = TestBed.inject(MatterService) as unknown as MockMatterService;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('loads matters on init and sets loadingMatters to false', () => {
    const mockMatters: Matter[] = [{ id: 'm1', title: 'Smith v. Acme', status: 'OPEN' }];
    matterService.getMatters.mockReturnValue(of({ data: mockMatters, total: 1, limit: 100, offset: 0 }));
    fixture.detectChanges();
    expect(component.matters()).toEqual(mockMatters);
    expect(component.loadingMatters()).toBe(false);
  });

  it('auto-selects matterId when only one matter exists (line 116)', () => {
    const mockMatters: Matter[] = [{ id: 'm1', title: 'Only Matter', status: 'OPEN' }];
    matterService.getMatters.mockReturnValue(of({ data: mockMatters, total: 1, limit: 100, offset: 0 }));
    fixture.detectChanges();
    expect(component.form.get('matterId')!.value).toBe('m1');
  });

  it('does not auto-select matterId when multiple matters exist', () => {
    const mockMatters: Matter[] = [
      { id: 'm1', title: 'Matter A', status: 'OPEN' },
      { id: 'm2', title: 'Matter B', status: 'OPEN' },
    ];
    matterService.getMatters.mockReturnValue(of({ data: mockMatters, total: 2, limit: 100, offset: 0 }));
    fixture.detectChanges();
    expect(component.form.get('matterId')!.value).toBe('');
  });

  it('handles getMatters error gracefully via catchError (line 112)', () => {
    matterService.getMatters.mockReturnValue(throwError(() => new Error('fail')));
    fixture.detectChanges();
    expect(component.matters()).toEqual([]);
    expect(component.loadingMatters()).toBe(false);
  });

  it('save closes dialog with form data (lines 120-128)', () => {
    fixture.detectChanges();
    component.form.setValue({ title: 'NDA', matterId: 'm1', valueDollars: null, currency: 'USD' });
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith({ title: 'NDA', matterId: 'm1' });
  });

  it('save includes valueCents and currency when valueDollars is provided (line 126)', () => {
    fixture.detectChanges();
    component.form.setValue({ title: 'MSA', matterId: 'm1', valueDollars: 1500, currency: 'EUR' });
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith({
      title: 'MSA', matterId: 'm1', valueCents: 150000, currency: 'EUR',
    });
  });

  it('save does nothing when form is invalid (line 121)', () => {
    fixture.detectChanges();
    component.form.setValue({ title: '', matterId: '', valueDollars: null, currency: 'USD' });
    component.save();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
