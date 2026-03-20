import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ContractDetailComponent } from './contract-detail.component';
import { ContractService, Contract, ContractVersion } from '../../services/contract.service';

const mockContract: Contract = {
  id: 'c1', title: 'NDA Agreement', status: 'DRAFT',
  valueCents: 150000, currency: 'USD',
};

const mockVersions: ContractVersion[] = [
  { id: 'v1', contractId: 'c1', number: 1, storageKey: 'k1', mimeType: 'application/pdf', sizeBytes: 2048, title: 'Initial draft' },
];

class MockContractService {
  getContract = jest.fn((id: string) => {
    if (id === 'c1') return of(mockContract);
    return of(null as any);
  });
  getVersions = jest.fn((id: string) => {
    if (id === 'c1') return of(mockVersions);
    return of([]);
  });
}

describe('ContractDetailComponent', () => {
  let component: ContractDetailComponent;
  let fixture: ComponentFixture<ContractDetailComponent>;
  let contractService: MockContractService;
  let paramMapSubject: Subject<any>;

  async function setup() {
    paramMapSubject = new Subject();
    await TestBed.configureTestingModule({
      imports: [ContractDetailComponent],
      providers: [
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ContractService, useClass: MockContractService },
        { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContractDetailComponent);
    component = fixture.componentInstance;
    contractService = TestBed.inject(ContractService) as unknown as MockContractService;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'c1' }));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('calls getContract and getVersions with the ID from the route', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'c1' }));
    expect(contractService.getContract).toHaveBeenCalledWith('c1');
    expect(contractService.getVersions).toHaveBeenCalledWith('c1');
  });

  it('displays contract title and status', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'c1' }));
    fixture.detectChanges();
    const h2 = fixture.nativeElement.querySelector('h2');
    expect(h2.textContent).toBe('NDA Agreement');
    const badge = fixture.nativeElement.querySelector('.status-badge');
    expect(badge.textContent.toLowerCase()).toContain('draft');
  });

  it('displays version history', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'c1' }));
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.version-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('v1');
    expect(items[0].textContent).toContain('Initial draft');
  });

  it('shows empty versions message when no versions exist', async () => {
    await setup();
    (contractService.getVersions as jest.Mock).mockReturnValue(of([]));
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'c1' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No versions yet.');
  });

  it('sets error when no ID in route params', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({}));
    fixture.detectChanges();
    expect(component.error).toBe('No Contract ID provided in URL.');
    expect(contractService.getContract).not.toHaveBeenCalled();
  });

  it('sets error when getContract fails', async () => {
    await setup();
    const errSubject = new Subject<Contract>();
    (contractService.getContract as jest.Mock).mockReturnValue(errSubject.asObservable());
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'c1' }));
    errSubject.error(new Error('Not found'));
    fixture.detectChanges();
    expect(component.error).toBe('Could not load contract details.');
  });

  it('formatCents returns formatted currency', async () => {
    await setup();
    fixture.detectChanges();
    expect(component.formatCents(150000, 'USD')).toBe('$1,500.00');
    expect(component.formatCents(null, null)).toBe('—');
    expect(component.formatCents(100, null)).toBe('$1.00'); // null currency defaults to USD
  });

  it('formatBytes returns human-readable size', async () => {
    await setup();
    fixture.detectChanges();
    expect(component.formatBytes(512)).toBe('512 B');
    expect(component.formatBytes(2048)).toBe('2.0 KB');
    expect(component.formatBytes(1048576)).toBe('1.0 MB');
  });
});
