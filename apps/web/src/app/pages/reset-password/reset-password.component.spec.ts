import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ResetPasswordComponent } from './reset-password.component';
import { AuthService } from '../../services/auth.service';

class MockAuthService {
  resetPassword(_token: string, _pass: string) { return of({ ok: true }); }
  currentUser = () => null;
}

class MockAuthServiceFail {
  resetPassword(_token: string, _pass: string) {
    return throwError(() => ({ error: { error: 'Password reset token is invalid or expired' } }));
  }
  currentUser = () => null;
}

function makeRoute(token: string) {
  return {
    snapshot: { queryParamMap: { get: (k: string) => k === 'token' ? token : null } },
  };
}

describe('ResetPasswordComponent', () => {
  async function setup(token: string, serviceClass = MockAuthService) {
    await TestBed.configureTestingModule({
      imports: [ResetPasswordComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: serviceClass },
        { provide: ActivatedRoute, useValue: makeRoute(token) },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<ResetPasswordComponent> = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('creates successfully', async () => {
    const c = await setup('tok123');
    expect(c).toBeTruthy();
  });

  it('shows error when no token in URL', async () => {
    const c = await setup('');
    expect(c.errorMessage()).toMatch(/invalid or missing reset token/i);
  });

  it('shows done state on successful reset', async () => {
    const c = await setup('tok123');
    c.newPassword = 'NewPassword1!';
    c.confirmPassword = 'NewPassword1!';
    c.onSubmit();
    expect(c.done()).toBe(true);
    expect(c.loading()).toBe(false);
  });

  it('sets error when passwords do not match', async () => {
    const c = await setup('tok123');
    c.newPassword = 'NewPassword1!';
    c.confirmPassword = 'DifferentPass1!';
    c.onSubmit();
    expect(c.errorMessage()).toMatch(/do not match/i);
    expect(c.done()).toBe(false);
  });

  it('shows error on invalid/expired token from server', async () => {
    const c = await setup('expired-tok', MockAuthServiceFail);
    c.newPassword = 'NewPassword1!';
    c.confirmPassword = 'NewPassword1!';
    c.onSubmit();
    expect(c.done()).toBe(false);
    expect(c.errorMessage()).toMatch(/invalid or expired/i);
  });
});
