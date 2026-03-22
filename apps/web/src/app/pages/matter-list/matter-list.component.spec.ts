import 'zone.js/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { MatterListComponent, NewMatterDialogComponent } from './matter-list.component';
import { MatterService, MatterPage } from '../../services/matter.service';
import { MatDialogRef } from '@angular/material/dialog';

const mockPage: MatterPage = {
  data:   [
    { id: 'm1', title: 'Matter 1', status: 'OPEN' },
    { id: 'm2', title: 'Matter 2', status: 'CLOSED' },
  ],
  total: 2, limit: 200, offset: 0,
};

class MockMatterService {
  getMatters    = jest.fn(() => of(mockPage));
  createMatter  = jest.fn();
  deleteMatter  = jest.fn();
}

const snackMock = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

describe('MatterListComponent', () => {
  let component: MatterListComponent;
  let fixture: ComponentFixture<MatterListComponent>;
  let matterService: MockMatterService;

  beforeEach(async () => {
    snackMock.open.mockClear();
    snackMock.open.mockReturnValue({ onAction: () => of(void 0) });

    await TestBed.configureTestingModule({
      imports: [MatterListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatterService, useClass: MockMatterService },
        { provide: MatDialog,   useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } },
      ],
    })
      .overrideComponent(MatterListComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackMock }] },
      })
      .compileComponents();

    fixture       = TestBed.createComponent(MatterListComponent);
    component     = fixture.componentInstance;
    matterService = TestBed.inject(MatterService) as unknown as MockMatterService;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should call getMatters on init', () => {
    fixture.detectChanges();
    expect(matterService.getMatters).toHaveBeenCalled();
  });

  it('populates dataSource and total signal from page', () => {
    fixture.detectChanges();
    expect(component.dataSource.data).toHaveLength(2);
    expect(component.total()).toBe(2);
  });

  it('renders matter rows in the table', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.data-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Matter 1');
    expect(rows[1].textContent).toContain('Matter 2');
  });

  it('shows empty state when no matters', () => {
    matterService.getMatters.mockReturnValue(of({ data: [], total: 0, limit: 200, offset: 0 }));
    fixture.detectChanges();
    const empty = fixture.nativeElement.querySelector('.empty-state');
    expect(empty).toBeTruthy();
  });

  it('sets error signal when getMatters fails', () => {
    const subject = new Subject<MatterPage>();
    matterService.getMatters.mockReturnValue(subject.asObservable());
    fixture.detectChanges();
    subject.error(new Error('network'));
    fixture.detectChanges();
    expect(component.error()).toBe('Failed to load matters. Please try again.');
  });

  it('statusLabel returns readable labels', () => {
    expect(component.statusLabel('OPEN')).toBe('Open');
    expect(component.statusLabel('ON_HOLD')).toBe('On Hold');
    expect(component.statusLabel('CLOSED')).toBe('Closed');
  });

  // ── Coverage: lines 79-88 (NewMatterDialogComponent via openCreate) ──

  it('openCreate opens dialog and prepends created matter to dataSource', () => {
    fixture.detectChanges();
    const dialog = TestBed.inject(MatDialog) as any;
    const createdMatter = { id: 'm3', title: 'New Matter', status: 'OPEN' };
    const afterClosedSubject = new Subject<any>();
    dialog.open.mockReturnValue({ afterClosed: () => afterClosedSubject.asObservable() });
    matterService.createMatter.mockReturnValue(of(createdMatter));

    component.openCreate();
    afterClosedSubject.next({ title: 'New Matter', description: '', status: 'OPEN' });

    expect(matterService.createMatter).toHaveBeenCalledWith({ title: 'New Matter', description: '', status: 'OPEN' });
    expect(component.dataSource.data[0]).toEqual(createdMatter);
    expect(component.total()).toBe(3); // was 2 + 1
  });

  it('openCreate does nothing when dialog is cancelled', () => {
    fixture.detectChanges();
    const dialog = TestBed.inject(MatDialog) as any;
    const afterClosedSubject = new Subject<any>();
    dialog.open.mockReturnValue({ afterClosed: () => afterClosedSubject.asObservable() });

    component.openCreate();
    afterClosedSubject.next(undefined); // user cancelled

    expect(matterService.createMatter).not.toHaveBeenCalled();
  });

  it('openCreate shows error snackbar when createMatter fails', () => {
    fixture.detectChanges();
    const dialog = TestBed.inject(MatDialog) as any;
    const afterClosedSubject = new Subject<any>();
    dialog.open.mockReturnValue({ afterClosed: () => afterClosedSubject.asObservable() });
    matterService.createMatter.mockReturnValue(throwError(() => ({ error: { message: 'Duplicate title' } })));

    component.openCreate();
    afterClosedSubject.next({ title: 'Dup', description: '', status: 'OPEN' });

    expect(snackMock.open).toHaveBeenCalledWith('Duplicate title', 'Dismiss', expect.any(Object));
  });

  it('openCreate shows fallback error when createMatter fails without message', () => {
    fixture.detectChanges();
    const dialog = TestBed.inject(MatDialog) as any;
    const afterClosedSubject = new Subject<any>();
    dialog.open.mockReturnValue({ afterClosed: () => afterClosedSubject.asObservable() });
    matterService.createMatter.mockReturnValue(throwError(() => ({})));

    component.openCreate();
    afterClosedSubject.next({ title: 'Test', description: '', status: 'OPEN' });

    expect(snackMock.open).toHaveBeenCalledWith('Failed to create matter.', 'Dismiss', expect.any(Object));
  });

  // ── Coverage: lines 138 (statusFilter change triggers load) ──

  it('reload when statusFilter changes', () => {
    fixture.detectChanges();
    matterService.getMatters.mockClear();
    component.statusFilter.setValue('CLOSED');
    expect(matterService.getMatters).toHaveBeenCalled();
  });

  // ── Coverage: lines 170-203 (confirmDelete, goTo) ──

  it('confirmDelete removes matter from dataSource on success', () => {
    fixture.detectChanges();
    const actionSubject = new Subject<void>();
    snackMock.open.mockReturnValue({ onAction: () => actionSubject.asObservable() });
    matterService.deleteMatter.mockReturnValue(of(undefined));
    const ev = { stopPropagation: jest.fn() } as unknown as Event;

    component.confirmDelete({ id: 'm1', title: 'Matter 1', status: 'OPEN' } as any, ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
    actionSubject.next();

    expect(matterService.deleteMatter).toHaveBeenCalledWith('m1');
    expect(component.dataSource.data.find(m => m.id === 'm1')).toBeUndefined();
    expect(component.total()).toBe(1);
  });

  it('confirmDelete shows error snackbar when deleteMatter fails', () => {
    fixture.detectChanges();
    const actionSubject = new Subject<void>();
    snackMock.open.mockReturnValue({ onAction: () => actionSubject.asObservable() });
    matterService.deleteMatter.mockReturnValue(throwError(() => new Error('fail')));
    const ev = { stopPropagation: jest.fn() } as unknown as Event;

    component.confirmDelete({ id: 'm1', title: 'Matter 1', status: 'OPEN' } as any, ev);
    actionSubject.next();

    expect(snackMock.open).toHaveBeenCalledWith('Failed to delete matter.', 'Dismiss', expect.any(Object));
  });

  it('goTo navigates to the matter detail page', () => {
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    component.goTo({ id: 'm1', title: 'Matter 1', status: 'OPEN' } as any);
    expect(router.navigate).toHaveBeenCalledWith(['/matters', 'm1']);
  });

  it('statusLabel returns the raw string for unknown status', () => {
    expect(component.statusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  // ── Coverage: line 134 (search filter), line 149 (filterPredicate) ──

  it('search control applies filter to dataSource after debounce', fakeAsync(() => {
    fixture.detectChanges();
    component.search.setValue('Matter 1');
    tick(250); // debounceTime(200)
    expect(component.dataSource.filter).toBe('matter 1');
  }));

  it('filterPredicate matches on description', () => {
    fixture.detectChanges();
    component.dataSource.data = [
      { id: 'm1', title: 'Alpha', description: 'Beta description', status: 'OPEN' } as any,
    ];
    component.dataSource.filter = 'beta';
    expect(component.dataSource.filteredData).toHaveLength(1);
  });

  it('filterPredicate handles null description', () => {
    fixture.detectChanges();
    component.dataSource.data = [
      { id: 'm1', title: 'Alpha', description: null, status: 'OPEN' } as any,
    ];
    component.dataSource.filter = 'nomatch';
    expect(component.dataSource.filteredData).toHaveLength(0);
  });
});

// ── NewMatterDialogComponent (lines 79-88) ──────────────────────────────────

describe('NewMatterDialogComponent', () => {
  let component: NewMatterDialogComponent;
  let fixture: ComponentFixture<NewMatterDialogComponent>;
  let dialogRefMock: { close: jest.Mock };

  beforeEach(async () => {
    dialogRefMock = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewMatterDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(NewMatterDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('form starts with empty title and OPEN status', () => {
    expect(component.form.getRawValue()).toEqual({ title: '', description: '', status: 'OPEN' });
  });

  it('save closes dialog with form data when form is valid', () => {
    component.form.patchValue({ title: 'Test Matter', description: 'Desc', status: 'ON_HOLD' });
    component.save();
    expect(dialogRefMock.close).toHaveBeenCalledWith({ title: 'Test Matter', description: 'Desc', status: 'ON_HOLD' });
  });

  it('save does not close dialog when form is invalid', () => {
    component.form.patchValue({ title: '' }); // title is required
    component.save();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });
});
