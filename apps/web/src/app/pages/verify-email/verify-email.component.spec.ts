import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { VerifyEmailComponent } from './verify-email.component';
import { AuthService } from '../../services/auth.service';

class MockAuthService {
  verifyEmail(token: string) {
    if (token === 'valid-token') return of({ ok: true, token: 'new-jwt' });
    if (token === 'already-token') return of({ ok: true });
    return throwError(() => ({ error: { error: 'Verification token is invalid or expired' } }));
  }
  getMe() { return of(null); }
  currentUser = () => null;
  resendVerification(_email: string) { return of({ ok: true }); }
}

function makeRoute(token: string) {
  return {
    snapshot: { queryParamMap: { get: (k: string) => k === 'token' ? token : null } },
  };
}

describe('VerifyEmailComponent', () => {
  let component: VerifyEmailComponent;
  let fixture: ComponentFixture<VerifyEmailComponent>;
  let router: Router;

  async function setup(token: string) {
    await TestBed.configureTestingModule({
      imports: [VerifyEmailComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: ActivatedRoute, useValue: makeRoute(token) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VerifyEmailComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  }

  it('shows success state for a valid token', async () => {
    await setup('valid-token');
    expect(component.status()).toBe('success');
  });

  it('shows already state when no new token is returned', async () => {
    await setup('already-token');
    expect(component.status()).toBe('already');
  });

  it('shows error state for an invalid token', async () => {
    await setup('bad-token');
    expect(component.status()).toBe('error');
    expect(component.errorMessage()).toMatch(/invalid or expired/i);
  });

  it('shows error state when no token is provided', async () => {
    await setup('');
    expect(component.status()).toBe('error');
    expect(component.errorMessage()).toMatch(/no verification token/i);
  });
});
