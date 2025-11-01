// apps/web/src/app/pages/login/login.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

// --- Import required Material Modules for testing ---
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
// ----------------------------------------------------

// Create a mock AuthService
class MockAuthService {
  login(credentials: any) {
    if (credentials.email === 'test@example.com' && credentials.password === 'password') {
      return of({ token: 'fake-jwt-token' });
    } else {
      return throwError(() => ({ status: 401, error: 'Invalid credentials' }));
    }
  }
}

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authService: AuthService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        LoginComponent, // Standalone component
        FormsModule,
        NoopAnimationsModule, // <-- Add this for animations
        // --- Add Material Modules ---
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule
      ],
      providers: [
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Tests from previous file are still valid
  it('should navigate to dashboard on successful login', () => {
    const navigateSpy = jest.spyOn(router, 'navigate');
    component.email = 'test@example.com';
    component.password = 'password';
    component.onLogin();
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
    expect(component.errorMessage).toBe('');
  });

  it('should set error message on failed login', () => {
    const navigateSpy = jest.spyOn(router, 'navigate');
    component.email = 'wrong@example.com';
    component.password = 'wrong';
    component.onLogin();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('Invalid email or password. Please try again.');
  });
});