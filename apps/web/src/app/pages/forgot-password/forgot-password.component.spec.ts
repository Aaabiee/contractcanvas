import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ForgotPasswordComponent } from './forgot-password.component';
import { AuthService } from '../../services/auth.service';

class MockAuthService {
  forgotPassword(_email: string) { return of({ ok: true }); }
  currentUser = () => null;
}

class MockAuthServiceFail {
  forgotPassword(_email: string) { return throwError(() => new Error('network')); }
  currentUser = () => null;
}

describe('ForgotPasswordComponent', () => {
  async function setup(serviceClass = MockAuthService) {
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: serviceClass },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('creates successfully', async () => {
    const c = await setup();
    expect(c).toBeTruthy();
  });

  it('shows sent state after successful submission', async () => {
    const c = await setup();
    c.email = 'user@example.com';
    c.onSubmit();
    expect(c.sent()).toBe(true);
    expect(c.loading()).toBe(false);
  });

  it('shows error message on network failure', async () => {
    const c = await setup(MockAuthServiceFail);
    c.email = 'user@example.com';
    c.onSubmit();
    expect(c.sent()).toBe(false);
    expect(c.errorMessage()).toMatch(/try again/i);
  });
});
