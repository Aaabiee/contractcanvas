// apps/web/src/app/pages/matter-detail/matter-detail.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { MatterDetailComponent } from './matter-detail.component';
import { MatterService, Matter } from '../../services/matter.service';
import { Params } from '@angular/router'; // Import Params
import { convertToParamMap } from '@angular/router'; // Helper for mocking

const mockMatter: Matter = { id: 'm1', title: 'Test Matter', status: 'OPEN', description: 'Test description' };

// Mock MatterService
class MockMatterService {
  getMatter = jest.fn((id: string) => {
    if (id === 'm1') {
      return of(mockMatter);
    }
    return of(null as any); // Simulate not found
  });
}

describe('MatterDetailComponent', () => {
  let component: MatterDetailComponent;
  let fixture: ComponentFixture<MatterDetailComponent>;
  let matterService: MatterService;

  // Helper to provide mock route params
  const mockActivatedRoute = {
    paramMap: of(convertToParamMap({ id: 'm1' }))
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatterDetailComponent], // Standalone
      providers: [
        provideHttpClientTesting(),
        provideRouter([]), // For RouterLink
        { provide: MatterService, useClass: MockMatterService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();
    
    fixture = TestBed.createComponent(MatterDetailComponent);
    component = fixture.componentInstance;
    matterService = TestBed.inject(MatterService);
  });

  it('should create', () => {
    fixture.detectChanges(); // Triggers ngOnInit
    expect(component).toBeTruthy();
  });

  it('should call getMatter with the ID from the route', () => {
    fixture.detectChanges(); // ngOnInit
    expect(matterService.getMatter).toHaveBeenCalledWith('m1');
  });

  it('should display the matter details', () => {
    fixture.detectChanges(); // ngOnInit

    const titleEl = fixture.nativeElement.querySelector('h2');
    expect(titleEl.textContent).toBe('Test Matter');
    
    const statusEl = fixture.nativeElement.querySelector('.status-badge');
    expect(statusEl.textContent).toBe('OPEN');

    const descEl = fixture.nativeElement.querySelector('.description');
    expect(descEl.textContent).toBe('Test description');
  });
});