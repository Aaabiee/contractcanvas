import 'zone.js/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService, User } from './auth.service';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a minimal but structurally valid JWT string with a far-future
 * exp so that scheduleRefresh sets a timer that never fires during the test.
 */
function makeFakeJwt(sub = 'u1'): string {
  const exp     = Math.floor(Date.now() / 1000) + 3600; // 1 h from now
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub, exp }));
  return `${header}.${payload}.sig`;
}

const mockUser: User = {
  id:    'u1',
  email: 'a@b.com',
  name:  { firstName: 'A', lastName: 'B' },
  role:  'LAWYER',
};

// ── shared setup ─────────────────────────────────────────────────────────────

/**
 * Flush the constructor-triggered silentRefresh with a 401 so the service
 * starts in a clean logged-out state without any navigation side-effects.
 */
function flushSilentRefreshFailure(httpMock: HttpTestingController): void {
  httpMock
    .expectOne('/api/auth/refresh-token')
    .flush({ error: 'No session' }, { status: 401, statusText: 'Unauthorized' });
}

// ── main suite ────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(
    fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [
          // Provide a real router with a /login route so navigation doesn't throw.
          provideRouter([{ path: 'login', component: class DummyLogin {} }]),
          AuthService,
        ],
      });

      service  = TestBed.inject(AuthService);
      httpMock = TestBed.inject(HttpTestingController);
      router   = TestBed.inject(Router);

      // Prevent scheduleRefresh from queuing timers that outlive the test.
      jest.spyOn(service as any, 'scheduleRefresh').mockImplementation(() => {});

      // Drain the silentRefresh started in the constructor.
      flushSilentRefreshFailure(httpMock);
      tick();
    }),
  );

  afterEach(() => {
    // Cancel any pending refresh timers to avoid "timers still in queue" errors.
    (service as any).cancelRefreshTimer();
    httpMock.verify();
  });

  // ── isLoggedIn() ────────────────────────────────────────────────────────────

  describe('isLoggedIn()', () => {
    it('returns false when no token is in memory', () => {
      expect(service.isLoggedIn()).toBe(false);
    });

    it('returns true after a successful login', fakeAsync(() => {
      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      httpMock.expectOne('/api/auth/login').flush({ token: makeFakeJwt(), user: mockUser });
      tick();

      expect(service.isLoggedIn()).toBe(true);
    }));
  });

  // ── getToken() ──────────────────────────────────────────────────────────────

  describe('getToken()', () => {
    it('returns null when no token is in memory', () => {
      expect(service.getToken()).toBeNull();
    });

    it('returns the in-memory token after login', fakeAsync(() => {
      const jwt = makeFakeJwt();
      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      httpMock.expectOne('/api/auth/login').flush({ token: jwt, user: mockUser });
      tick();

      expect(service.getToken()).toBe(jwt);
    }));
  });

  // ── login() ─────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('stores token and sets currentUser on success', fakeAsync(() => {
      const jwt = makeFakeJwt();

      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      const req = httpMock.expectOne('/api/auth/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'a@b.com', password: 'pass' });
      req.flush({ token: jwt, user: mockUser });
      tick();

      expect(service.getToken()).toBe(jwt);
      expect(service.currentUser()).toEqual(mockUser);
    }));

    it('calls GET /me when login response has no user field', fakeAsync(() => {
      const jwt        = makeFakeJwt('u2');
      const userFromMe = { id: 'u2', email: 'b@c.com', name: { firstName: 'B', lastName: 'C' }, role: 'CLIENT' as const };

      service.login({ email: 'b@c.com', password: 'pass' }).subscribe();
      httpMock.expectOne('/api/auth/login').flush({ token: jwt }); // no user field
      tick();

      httpMock.expectOne('/api/auth/me').flush(userFromMe);
      tick();

      expect(service.currentUser()).toEqual(userFromMe);
    }));
  });

  // ── logout() ────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('clears token, resets currentUser, navigates to /login, and calls DELETE session', fakeAsync(() => {
      // Pre-load a token via login.
      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      httpMock.expectOne('/api/auth/login').flush({ token: makeFakeJwt(), user: mockUser });
      tick();
      expect(service.isLoggedIn()).toBe(true);

      const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      service.logout();

      // State is cleared synchronously.
      expect(service.getToken()).toBeNull();
      expect(service.currentUser()).toBeNull();
      expect(navSpy).toHaveBeenCalledWith(['/login']);

      // Flush the fire-and-forget server-side session deletion.
      httpMock.expectOne('/api/auth/logout').flush({ ok: true });
      tick();
    }));
  });

  // ── register() ──────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('stores token and sets currentUser on successful registration', fakeAsync(() => {
      const jwt     = makeFakeJwt();
      const regUser = { id: 'u1', email: 'new@example.com', name: { firstName: 'N', lastName: 'E' }, role: 'CLIENT' as const };
      const payload: any = {
        email: 'new@example.com', password: 'Password1!', confirmPassword: 'Password1!',
        name: { firstName: 'N', lastName: 'E' }, role: 'CLIENT', acceptTerms: true,
        orgMode: 'create', organizationName: 'Acme', organizationSlug: 'acme',
      };

      service.register(payload).subscribe();
      const req = httpMock.expectOne('/api/auth/register?autoLogin=1');
      expect(req.request.method).toBe('POST');
      req.flush({ token: jwt, user: regUser });
      tick();

      expect(service.getToken()).toBe(jwt);
      expect(service.currentUser()).toEqual(regUser);
    }));
  });

  // ── getMe() ─────────────────────────────────────────────────────────────────

  describe('getMe()', () => {
    it('returns null and makes no HTTP call when no token is in memory', fakeAsync(() => {
      let result: any;
      service.getMe().subscribe(u => (result = u));
      tick();

      httpMock.expectNone('/api/auth/me');
      expect(result).toBeNull();
    }));

    it('fetches /me and updates currentUser', fakeAsync(() => {
      // Load a token first.
      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      httpMock.expectOne('/api/auth/login').flush({ token: makeFakeJwt(), user: mockUser });
      tick();

      service.getMe().subscribe();
      httpMock.expectOne('/api/auth/me').flush(mockUser);
      tick();

      expect(service.currentUser()).toEqual(mockUser);
    }));

    it('calls logout and returns null on HTTP error', fakeAsync(() => {
      // Load a token first.
      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      httpMock.expectOne('/api/auth/login').flush({ token: makeFakeJwt(), user: mockUser });
      tick();

      const logoutSpy = jest.spyOn(service, 'logout');
      jest.spyOn(router, 'navigate').mockResolvedValue(true);
      let result: any = 'not-set';

      service.getMe().subscribe(u => (result = u));
      httpMock.expectOne('/api/auth/me').flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      tick();

      expect(logoutSpy).toHaveBeenCalled();
      expect(result).toBeNull();

      // Drain the fire-and-forget logout request triggered inside catchError.
      httpMock.expectOne('/api/auth/logout').flush({ ok: true });
      tick();
    }));
  });
});

// ── constructor — silent refresh ──────────────────────────────────────────────

describe('AuthService constructor — silent refresh', () => {
  it('recovers session when a valid refresh cookie exists on boot', fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        provideRouter([{ path: 'login', component: class DummyLogin {} }]),
        AuthService,
      ],
    });

    const svc  = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);

    // Constructor fires silentRefresh — flush with a valid token.
    const jwt = makeFakeJwt('u9');
    http.expectOne('/api/auth/refresh-token').flush({ token: jwt });
    tick();

    // silentRefresh success calls getMe().
    http.expectOne('/api/auth/me').flush({
      id: 'u9', email: 'boot@test.com',
      name: { firstName: 'Boot', lastName: 'User' }, role: 'ADMIN',
    });
    tick();

    expect(svc.currentUser()?.id).toBe('u9');
    expect(svc.isLoggedIn()).toBe(true);

    (svc as any).cancelRefreshTimer();
    http.verify();
  }));

  it('stays logged out when no session cookie exists on boot', fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        provideRouter([{ path: 'login', component: class DummyLogin {} }]),
        AuthService,
      ],
    });

    const svc  = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);

    flushSilentRefreshFailure(http);
    tick();

    expect(svc.isLoggedIn()).toBe(false);
    expect(svc.currentUser()).toBeNull();

    http.verify();
  }));
});

// ── verifyEmail, resendVerification, forgotPassword, resetPassword ──────────

describe('AuthService — additional methods', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(
    fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [
          provideRouter([{ path: 'login', component: class DummyLogin {} }]),
          AuthService,
        ],
      });

      service  = TestBed.inject(AuthService);
      httpMock = TestBed.inject(HttpTestingController);
      router   = TestBed.inject(Router);

      jest.spyOn(service as any, 'scheduleRefresh').mockImplementation(() => {});
      flushSilentRefreshFailure(httpMock);
      tick();
    }),
  );

  afterEach(() => {
    (service as any).cancelRefreshTimer();
    httpMock.verify();
  });

  // ── verifyEmail (lines 166-181) ──

  it('verifyEmail stores token and calls getMe when token is present', fakeAsync(() => {
    const jwt = makeFakeJwt('u5');
    service.verifyEmail('some-verify-token').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/api/auth/verify-email'));
    expect(req.request.method).toBe('GET');
    req.flush({ ok: true, token: jwt });
    tick();

    // After setting the token, verifyEmail calls getMe
    httpMock.expectOne('/api/auth/me').flush(mockUser);
    tick();

    expect(service.getToken()).toBe(jwt);
    expect(service.currentUser()).toEqual(mockUser);
  }));

  it('verifyEmail returns result without calling getMe when no token', fakeAsync(() => {
    let result: any;
    service.verifyEmail('some-token').subscribe(r => (result = r));

    httpMock.expectOne(r => r.url.includes('/api/auth/verify-email')).flush({ ok: true });
    tick();

    httpMock.expectNone('/api/auth/me');
    expect(result).toEqual({ ok: true });
  }));

  // ── resendVerification (lines 184-189) ──

  it('resendVerification sends POST with email', fakeAsync(() => {
    service.resendVerification('a@b.com').subscribe();
    const req = httpMock.expectOne('/api/auth/resend-verification');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.com' });
    req.flush({ ok: true });
    tick();
  }));

  // ── forgotPassword (lines 192-196) ──

  it('forgotPassword sends POST with email', fakeAsync(() => {
    let result: any;
    service.forgotPassword('forgot@test.com').subscribe(r => (result = r));
    const req = httpMock.expectOne('/api/auth/forgot-password');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'forgot@test.com' });
    req.flush({ ok: true });
    tick();
    expect(result).toEqual({ ok: true });
  }));

  // ── resetPassword (lines 199-203) ──

  it('resetPassword sends POST with token and newPassword', fakeAsync(() => {
    let result: any;
    service.resetPassword('reset-tok', 'NewPass1!').subscribe(r => (result = r));
    const req = httpMock.expectOne('/api/auth/reset-password');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'reset-tok', newPassword: 'NewPass1!' });
    req.flush({ ok: true });
    tick();
    expect(result).toEqual({ ok: true });
  }));

  // ── emailVerified() (line 163) ──

  it('emailVerified returns false when no current user', () => {
    expect(service.emailVerified()).toBe(false);
  });

  it('emailVerified returns true when currentUser has emailVerified', fakeAsync(() => {
    service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
    httpMock.expectOne('/api/auth/login').flush({
      token: makeFakeJwt(),
      user: { ...mockUser, emailVerified: true },
    });
    tick();
    expect(service.emailVerified()).toBe(true);
  }));
});

// ── scheduleRefresh edge cases ──────────────────────────────────────────────

describe('AuthService — scheduleRefresh', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(
    fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [
          provideRouter([
            { path: 'login', component: class DummyLogin {} },
          ]),
          AuthService,
        ],
      });

      service  = TestBed.inject(AuthService);
      httpMock = TestBed.inject(HttpTestingController);
      router   = TestBed.inject(Router);

      // Drain constructor silentRefresh
      flushSilentRefreshFailure(httpMock);
      tick();
    }),
  );

  afterEach(() => {
    (service as any).cancelRefreshTimer();
    httpMock.verify();
  });

  it('triggers immediate silentRefresh when token is about to expire (refreshIn <= 0)', fakeAsync(() => {
    // Create a JWT that expires in the past (so refreshIn <= 0)
    const exp     = Math.floor(Date.now() / 1000) - 10; // 10s ago
    const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: 'u1', exp }));
    const expiredJwt = `${header}.${payload}.sig`;

    // Call scheduleRefresh directly (it's private, so use bracket notation)
    (service as any).scheduleRefresh(expiredJwt);

    // Should have triggered silentRefresh immediately — flush it
    httpMock.expectOne('/api/auth/refresh-token').flush(
      { error: 'expired' }, { status: 401, statusText: 'Unauthorized' },
    );
    tick();
  }));

  it('calls logout when token is malformed (scheduleRefresh catch block)', fakeAsync(() => {
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const logoutSpy = jest.spyOn(service, 'logout');

    // A completely malformed JWT that will cause JSON.parse(atob(...)) to throw
    (service as any).scheduleRefresh('not.a.jwt');

    expect(logoutSpy).toHaveBeenCalled();

    // Drain the fire-and-forget logout POST
    httpMock.expectOne('/api/auth/logout').flush({ ok: true });
    tick();
  }));

  it('schedules a timer-based silentRefresh when token has valid future expiry', fakeAsync(() => {
    // Create a JWT that expires 62 seconds from now (refreshIn = 2000ms)
    const exp    = Math.floor(Date.now() / 1000) + 62;
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: 'u1', exp }));
    const jwt = `${header}.${payload}.sig`;

    (service as any).scheduleRefresh(jwt);

    // Advance past the timer (refreshIn ~= 2000ms)
    tick(3000);

    // The timer should have triggered silentRefresh — flush it
    httpMock.expectOne('/api/auth/refresh-token').flush(
      { error: 'expired' }, { status: 401, statusText: 'Unauthorized' },
    );
    tick();
  }));
});
