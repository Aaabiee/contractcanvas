import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { MatterDetailComponent } from './matter-detail.component';
import { MatterService, Matter } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { DocumentService } from '../../services/document.service';

const mockMatter: Matter = {
  id: 'm1', title: 'Test Matter', status: 'OPEN', description: 'Test description',
};

class MockMatterService {
  getMatter = jest.fn((id: string) => id === 'm1' ? of(mockMatter) : of(null as any));
}

class MockContractService {
  getContracts = jest.fn(() => of([]));
}

class MockDocumentService {
  getDocuments = jest.fn(() => of([]));
}

describe('MatterDetailComponent', () => {
  let component: MatterDetailComponent;
  let fixture: ComponentFixture<MatterDetailComponent>;
  let matterService: MockMatterService;
  let paramMapSubject: Subject<any>;

  async function setup() {
    paramMapSubject = new Subject();
    await TestBed.configureTestingModule({
      imports: [MatterDetailComponent],
      providers: [
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MatterService, useClass: MockMatterService },
        { provide: ContractService, useClass: MockContractService },
        { provide: DocumentService, useClass: MockDocumentService },
        { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MatterDetailComponent);
    component = fixture.componentInstance;
    matterService = TestBed.inject(MatterService) as unknown as MockMatterService;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('calls getMatter with the ID from the route', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    expect(matterService.getMatter).toHaveBeenCalledWith('m1');
  });

  it('displays the matter title, status, and description', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    fixture.detectChanges();
    const h2 = fixture.nativeElement.querySelector('h2');
    expect(h2.textContent).toBe('Test Matter');
    const badge = fixture.nativeElement.querySelector('.status-badge');
    expect(badge.textContent).toBe('OPEN');
    const desc = fixture.nativeElement.querySelector('.description');
    expect(desc.textContent).toBe('Test description');
  });

  it('sets error when no ID in route params', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({}));
    fixture.detectChanges();
    expect(component.error).toBe('No Matter ID provided in URL.');
    expect(matterService.getMatter).not.toHaveBeenCalled();
  });

  it('sets error when getMatter fails', async () => {
    await setup();
    const errSubject = new Subject<Matter>();
    (TestBed.inject(MatterService) as unknown as MockMatterService).getMatter.mockReturnValue(
      errSubject.asObservable()
    );
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    errSubject.error(new Error('Not found'));
    fixture.detectChanges();
    expect(component.error).toBe('Could not load matter details.');
  });

  it('shows empty contracts and documents sections', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    fixture.detectChanges();
    const emptyTexts = Array.from(fixture.nativeElement.querySelectorAll('.empty-list'))
      .map((el: any) => el.textContent);
    expect(emptyTexts.some(t => t.includes('No contracts'))).toBe(true);
    expect(emptyTexts.some(t => t.includes('No documents'))).toBe(true);
  });
});
