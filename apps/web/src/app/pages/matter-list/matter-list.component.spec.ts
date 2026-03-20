import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { MatterListComponent } from './matter-list.component';
import { MatterService, MatterPage } from '../../services/matter.service';

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

describe('MatterListComponent', () => {
  let component: MatterListComponent;
  let fixture: ComponentFixture<MatterListComponent>;
  let matterService: MockMatterService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatterListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatterService, useClass: MockMatterService },
        { provide: MatDialog,   useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: { open: jest.fn(() => ({ onAction: () => of(void 0) })) } },
      ],
    }).compileComponents();

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
});
