import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';

class MockAuthService {
  register = jest.fn(() => of({ redirectTo: '/login' }));
}

function setValidForm(component: RegisterComponent) {
  component.acceptTerms = true;
  component.email = 'new@example.com';
  component.password = 'password123';
  component.confirmPassword = 'password123';
  component.firstName = 'Alice';
  component.lastName = 'Smith';
  component.orgMode = 'create';
  component.organizationName = 'Acme';
  component.organizationSlug = 'acme';
}

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authService: MockAuthService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterComponent, NoopAnimationsModule],
      providers: [
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService) as unknown as MockAuthService;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows error when acceptTerms is false', () => {
    component.acceptTerms = false;
    component.onRegister();
    expect(component.errorMessage).toBe('You must accept the Terms of Service to continue.');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('shows error when passwords do not match', () => {
    component.acceptTerms = true;
    component.password = 'abc123';
    component.confirmPassword = 'different';
    component.onRegister();
    expect(component.errorMessage).toBe('Passwords do not match.');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('shows error when first or last name is missing', () => {
    component.acceptTerms = true;
    component.password = 'abc123';
    component.confirmPassword = 'abc123';
    component.firstName = '';
    component.lastName = '';
    component.onRegister();
    expect(component.errorMessage).toBe('First and Last name are required.');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('navigates to / on successful registration (create mode)', () => {
    const spy = jest.spyOn(router, 'navigateByUrl');
    setValidForm(component);
    component.onRegister();
    expect(spy).toHaveBeenCalledWith('/');
    expect(component.errorMessage).toBe('');
  });

  it('navigates to / on successful registration (join mode)', () => {
    const spy = jest.spyOn(router, 'navigateByUrl');
    setValidForm(component);
    component.orgMode = 'join';
    component.inviteToken = 'invite-abc';
    component.onRegister();
    expect(spy).toHaveBeenCalledWith('/');
  });

  it('shows 409 error when email is already in use', () => {
    (authService.register as jest.Mock).mockReturnValue(throwError(() => ({ status: 409 })));
    setValidForm(component);
    component.onRegister();
    expect(component.errorMessage).toBe('This email is already in use.');
  });

  it('shows err.message as error on non-409 failure', () => {
    (authService.register as jest.Mock).mockReturnValue(
      throwError(() => ({ status: 500, message: 'Server error' }))
    );
    setValidForm(component);
    component.onRegister();
    expect(component.errorMessage).toBe('Server error');
  });

  it('shows err.error.message when present', () => {
    (authService.register as jest.Mock).mockReturnValue(
      throwError(() => ({ status: 422, error: { message: 'Validation failed' } }))
    );
    setValidForm(component);
    component.onRegister();
    expect(component.errorMessage).toBe('Validation failed');
  });

  it('shows first field error from details.fieldErrors', () => {
    (authService.register as jest.Mock).mockReturnValue(
      throwError(() => ({
        status: 400,
        error: { details: { fieldErrors: { email: ['Email is invalid'] } } },
      }))
    );
    setValidForm(component);
    component.onRegister();
    expect(component.errorMessage).toBe('Email is invalid');
  });

  it('shows fallback message when no specific error info', () => {
    (authService.register as jest.Mock).mockReturnValue(throwError(() => ({})));
    setValidForm(component);
    component.onRegister();
    expect(component.errorMessage).toBe('Registration failed. Please try again.');
  });
});
