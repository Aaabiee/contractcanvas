// apps/web/src/app/pages/dashboard/dashboard.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { AuthService } from '../../services/auth.service';

// Mock AuthService
class MockAuthService {
  // Use jest.fn() to spy on the method call
  logout = jest.fn();
}

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let authService: AuthService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent], // Import standalone component
      providers: [
        provideRouter([]), // Provide mock router
        { provide: AuthService, useClass: MockAuthService }
      ]
    }).compileComponents();
    
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService); // Get the mocked service
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call authService.logout() when onLogout() is called', () => {
    // Trigger the click
    component.onLogout();
    
    // Expect the mocked service's logout method to have been called
    expect(authService.logout).toHaveBeenCalledTimes(1);
  });
});