import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { ContractListComponent } from './contract-list.component';
import { ContractService, Contract, ContractPage } from '../../services/contract.service';
import { MatterService } from '../../services/matter.service';

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractListComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ContractService, useClass: MockContractService },
        { provide: MatterService,   useClass: MockMatterService   },
        { provide: MatDialog,   useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: { open: jest.fn(() => ({ onAction: () => of(void 0) })) } },
      ],
    }).compileComponents();

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
});
