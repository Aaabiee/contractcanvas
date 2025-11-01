// apps/web/src/app/pages/matter-list/matter-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MatterListComponent } from './matter-list.component';
import { MatterService, Matter } from '../../services/matter.service';

const mockMatters: Matter[] = [
  { id: 'm1', title: 'Matter 1', status: 'OPEN' },
  { id: 'm2', title: 'Matter 2', status: 'CLOSED' }
];

// Mock MatterService
class MockMatterService {
  getMatters = jest.fn(() => of(mockMatters));
}

describe('MatterListComponent', () => {
  let component: MatterListComponent;
  let fixture: ComponentFixture<MatterListComponent>;
  let matterService: MatterService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatterListComponent], // Standalone
      providers: [
        provideHttpClientTesting(), // For any other http calls
        provideRouter([]), // For RouterLink
        { provide: MatterService, useClass: MockMatterService }
      ]
    }).compileComponents();
    
    fixture = TestBed.createComponent(MatterListComponent);
    component = fixture.componentInstance;
    matterService = TestBed.inject(MatterService);
  });

  it('should create', () => {
    fixture.detectChanges(); // Triggers ngOnInit
    expect(component).toBeTruthy();
  });

  it('should call getMatters on init', () => {
    fixture.detectChanges(); // Triggers ngOnInit
    expect(matterService.getMatters).toHaveBeenCalled();
  });

  it('should display a list of matters', () => {
    fixture.detectChanges(); // ngOnInit -> matters$ is set and subscribed by async pipe
    
    const listItems = fixture.nativeElement.querySelectorAll('.matter-item');
    expect(listItems.length).toBe(2);
    expect(listItems[0].textContent).toContain('Matter 1');
    expect(listItems[0].textContent).toContain('OPEN');
    expect(listItems[1].textContent).toContain('Matter 2');
    expect(listItems[1].textContent).toContain('CLOSED');
  });

  it('should display "No matters found" message when list is empty', () => {
    // Override the mock for this specific test
    (matterService.getMatters as jest.Mock).mockReturnValue(of([]));
    
    fixture.detectChanges(); // ngOnInit -> matters$ is []
    
    const emptyMessage = fixture.nativeElement.querySelector('.empty-list');
    expect(emptyMessage).toBeTruthy();
    expect(emptyMessage.textContent).toContain('No matters found.');
  });
});