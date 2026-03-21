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
