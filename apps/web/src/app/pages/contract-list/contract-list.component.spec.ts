import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ContractListComponent } from './contract-list.component';
import { ContractService, Contract, ContractPage } from '../../services/contract.service';

const mockContracts: Contract[] = [
  { id: 'c1', title: 'NDA', status: 'DRAFT' },
  { id: 'c2', title: 'MSA', status: 'EXECUTED' },
];

const mockPage = (data: Contract[]): ContractPage => ({ data, total: data.length, limit: 10, offset: 0 });

class MockContractService {
  getContracts = jest.fn(() => of(mockPage(mockContracts)));
}

describe('ContractListComponent', () => {
  let component: ContractListComponent;
  let fixture: ComponentFixture<ContractListComponent>;
  let contractService: MockContractService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractListComponent],
      providers: [
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ContractService, useClass: MockContractService },
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

  it('displays a list of contracts', () => {
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.contract-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('NDA');
    expect(items[0].textContent).toContain('DRAFT');
    expect(items[1].textContent).toContain('MSA');
    expect(items[1].textContent).toContain('EXECUTED');
  });

  it('displays "No contracts found" when list is empty', () => {
    (contractService.getContracts as jest.Mock).mockReturnValue(of(mockPage([])));
    fixture.detectChanges();
    const empty = fixture.nativeElement.querySelector('.empty-list');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No contracts found.');
  });

  it('sets error message when getContracts fails', () => {
    const subject = new Subject<ContractPage>();
    (contractService.getContracts as jest.Mock).mockReturnValue(subject.asObservable());
    fixture.detectChanges();
    subject.error(new Error('Network error'));
    fixture.detectChanges();
    expect(component.error).toBe('Could not load contracts. Please try again later.');
  });
});
