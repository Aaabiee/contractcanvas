import { TestBed } from '@angular/core/testing';
import { CanActivateFn, provideRouter, Router } from '@angular/router';
import { authGuard } from './auth-guard';
import { AuthService } from '../services/auth.service';

describe('authGuard', () => {
  let router: Router;
  let authService: { isLoggedIn: jest.Mock };

  const executeGuard: CanActivateFn = (...args) =>
    TestBed.runInInjectionContext(() => authGuard(...args));

  beforeEach(() => {
    authService = { isLoggedIn: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('returns true when user is logged in', () => {
    authService.isLoggedIn.mockReturnValue(true);
    const result = executeGuard({} as any, {} as any);
    expect(result).toBe(true);
  });

  it('returns false when user is not logged in', () => {
    authService.isLoggedIn.mockReturnValue(false);
    const result = executeGuard({} as any, {} as any);
    expect(result).toBe(false);
  });

  it('navigates to /login when user is not logged in', () => {
    authService.isLoggedIn.mockReturnValue(false);
    const navSpy = jest.spyOn(router, 'navigate');
    executeGuard({} as any, {} as any);
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('does not navigate when user is logged in', () => {
    authService.isLoggedIn.mockReturnValue(true);
    const navSpy = jest.spyOn(router, 'navigate');
    executeGuard({} as any, {} as any);
    expect(navSpy).not.toHaveBeenCalled();
  });
});
