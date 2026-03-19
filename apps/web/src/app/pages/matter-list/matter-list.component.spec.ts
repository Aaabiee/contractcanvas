import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { MatterListComponent } from './matter-list.component';
import { MatterService, Matter } from '../../services/matter.service';

const mockMatters: Matter[] = [
  { id: 'm1', title: 'Matter 1', status: 'OPEN' },
  { id: 'm2', title: 'Matter 2', status: 'CLOSED' },
];

class MockMatterService {
  getMatters = jest.fn(() => of(mockMatters));
}

describe('MatterListComponent', () => {
  let component: MatterListComponent;
  let fixture: ComponentFixture<MatterListComponent>;
  let matterService: MockMatterService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatterListComponent],
      providers: [
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MatterService, useClass: MockMatterService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MatterListComponent);
    component = fixture.componentInstance;
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

  it('should display a list of matters', () => {
    fixture.detectChanges();
    const listItems = fixture.nativeElement.querySelectorAll('.matter-item');
    expect(listItems.length).toBe(2);
    expect(listItems[0].textContent).toContain('Matter 1');
    expect(listItems[0].textContent).toContain('OPEN');
    expect(listItems[1].textContent).toContain('Matter 2');
    expect(listItems[1].textContent).toContain('CLOSED');
  });

  it('should display "No matters found" message when list is empty', () => {
    (matterService.getMatters as jest.Mock).mockReturnValue(of([]));
    fixture.detectChanges();
    const emptyMessage = fixture.nativeElement.querySelector('.empty-list');
    expect(emptyMessage).toBeTruthy();
    expect(emptyMessage.textContent).toContain('No matters found.');
  });

  it('sets error message when getMatters fails', () => {
    const subject = new Subject<Matter[]>();
    (matterService.getMatters as jest.Mock).mockReturnValue(subject.asObservable());
    fixture.detectChanges();
    subject.error(new Error('Network error'));
    fixture.detectChanges();
    expect(component.error).toBe('Could not load matters. Please try again later.');
  });
});
