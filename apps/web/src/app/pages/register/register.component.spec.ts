import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

// Create a mock AuthService
class MockAuthService {
  register(credentials: any) {
    if (credentials.email === 'new@example.com') {
      return of({ success: true });
    } else if (credentials.email === 'exists@example.com') {
      return throwError(() => ({ status: 409, error: 'User exists' }));
    } else {
      return throwError(() => ({ status: 500, error: 'Server error' }));
    }
  }
}

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authService: AuthService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Import the standalone component directly.
      imports: [RegisterComponent], 
      providers: [
        // --- ADD THE NEW PROVIDERS ---
        provideHttpClientTesting(), // Replaces HttpClientTestingModule
        provideRouter([]),          // Replaces RouterTestingModule
        // -----------------------------
        { provide: AuthService, useClass: MockAuthService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should navigate to login on successful registration', () => {
    const navigateSpy = jest.spyOn(router, 'navigate');
    
    component.email = 'new@example.com';
    component.password = 'newpassword';
    
    component.onRegister();

    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    expect(component.errorMessage).toBe('');
  });

  it('should set 409 error message if email is already in use', () => {
    const navigateSpy = jest.spyOn(router, 'navigate');

    component.email = 'exists@example.com';
    component.password = 'password';

    component.onRegister();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('This email is already in use.');
  });

  it('should set a generic error message on other failures', () => {
    const navigateSpy = jest.spyOn(router, 'navigate');

    component.email = 'error@example.com';
    component.password = 'password';

    component.onRegister();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('Registration failed. Please try again.');
  });
});