import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ContractDetailComponent } from './contract-detail.component';
import { ContractService, Contract, ContractVersion } from '../../services/contract.service';
import { CommentService } from '../../services/comment.service';
import { AuthService } from '../../services/auth.service';

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

class MockCommentService {
  getComments   = jest.fn(() => of({ data: [], total: 0, limit: 100, offset: 0 }));
  createComment = jest.fn(() => of({}));
  updateComment = jest.fn(() => of({}));
  deleteComment = jest.fn(() => of(undefined));
}

class MockAuthService {
  currentUser = signal<any>(null);
  silentRefresh = () => of(false);
}

describe('ContractDetailComponent', () => {
  let component: ContractDetailComponent;
  let fixture: ComponentFixture<ContractDetailComponent>;
  let contractService: MockContractService;
  let paramMapSubject: Subject<any>;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function setup() {
    paramMapSubject = new Subject();
    await TestBed.configureTestingModule({
      imports: [ContractDetailComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ContractService, useClass: MockContractService },
        { provide: CommentService,  useClass: MockCommentService  },
        { provide: AuthService,     useClass: MockAuthService     },
        { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContractDetailComponent);
    component = fixture.componentInstance;
    contractService = TestBed.inject(ContractService) as unknown as MockContractService;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

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

  it('loadEnvelopes fetches signatures for a contract', async () => {
    await setup();
    fixture.detectChanges();
    const httpMock = TestBed.inject(HttpTestingController);
    component.loadEnvelopes('c1');
    const req = httpMock.expectOne('/api/signatures?contractId=c1');
    req.flush([{ id: 'env-1', provider: 'docusign', status: 'SENT', recipients: [], createdAt: '2024-01-01' }]);
    expect(component.envelopes()).toHaveLength(1);
    httpMock.verify();
  });

  it('sendForSignature posts and updates envelopes list', async () => {
    await setup();
    fixture.detectChanges();
    const httpMock = TestBed.inject(HttpTestingController);
    component.sendForSignature('c1');
    expect(component.sendingSig()).toBe(true);
    const req = httpMock.expectOne('/api/signatures');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.contractId).toBe('c1');
    req.flush({ id: 'env-new', provider: 'docusign', status: 'SENT', recipients: [], createdAt: '2024-01-01' });
    expect(component.sendingSig()).toBe(false);
    expect(component.envelopes()).toHaveLength(1);
    httpMock.verify();
  });

  it('generatePdf posts and resets signal', async () => {
    await setup();
    fixture.detectChanges();
    const httpMock = TestBed.inject(HttpTestingController);
    (globalThis as any).URL.createObjectURL = jest.fn().mockReturnValue('blob:test');
    (globalThis as any).URL.revokeObjectURL = jest.fn();
    component.generatePdf('c1');
    expect(component.generatingPdf()).toBe(true);
    const req = httpMock.expectOne('/api/contracts/c1/generate-pdf');
    expect(req.request.method).toBe('POST');
    req.flush(new Blob(['pdf-content']));
    expect(component.generatingPdf()).toBe(false);
    httpMock.verify();
  });

  it('sendForSignature error resets sendingSig and shows snackbar (lines 104-106)', async () => {
    await setup();
    fixture.detectChanges();
    const httpMock = TestBed.inject(HttpTestingController);
    component.sendForSignature('c1');
    expect(component.sendingSig()).toBe(true);
    const req = httpMock.expectOne('/api/signatures');
    req.flush({ error: 'No recipients' }, { status: 400, statusText: 'Bad Request' });
    expect(component.sendingSig()).toBe(false);
    httpMock.verify();
  });

  it('generatePdf error resets generatingPdf and shows snackbar (lines 123-125)', async () => {
    await setup();
    fixture.detectChanges();
    const httpMock = TestBed.inject(HttpTestingController);
    component.generatePdf('c1');
    expect(component.generatingPdf()).toBe(true);
    const req = httpMock.expectOne('/api/contracts/c1/generate-pdf');
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
    expect(component.generatingPdf()).toBe(false);
    httpMock.verify();
  });
});
