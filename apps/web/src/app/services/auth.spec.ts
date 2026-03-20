import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [provideRouter([]), AuthService],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  describe('isLoggedIn()', () => {
    it('returns false when no token in localStorage', () => {
      expect(service.isLoggedIn()).toBe(false);
    });

    it('returns true when token exists in localStorage', () => {
      localStorage.setItem('contractcanvas_auth_token', 'test-token');
      expect(service.isLoggedIn()).toBe(true);
    });
  });

  describe('getToken()', () => {
    it('returns null when no token stored', () => {
      expect(service.getToken()).toBeNull();
    });

    it('returns the stored token', () => {
      localStorage.setItem('contractcanvas_auth_token', 'my-jwt');
      expect(service.getToken()).toBe('my-jwt');
    });
  });

  describe('login()', () => {
    it('stores token and sets currentUser on success', fakeAsync(() => {
      const user = { id: 'u1', email: 'a@b.com', name: { firstName: 'A', lastName: 'B' }, role: 'LAWYER' as const };
      const response = { token: 'jwt-abc', user };

      service.login({ email: 'a@b.com', password: 'pass' }).subscribe();
      const req = httpMock.expectOne('/api/auth/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'a@b.com', password: 'pass' });
      req.flush(response);
      tick();

      expect(service.getToken()).toBe('jwt-abc');
      expect(service.currentUser()).toEqual(user);
    }));

    it('calls getMe when login response has no user', fakeAsync(() => {
      const response = { token: 'jwt-xyz' };
      const userFromMe = { id: 'u2', email: 'b@c.com', name: { firstName: 'B', lastName: 'C' }, role: 'CLIENT' as const };

      service.login({ email: 'b@c.com', password: 'pass' }).subscribe();
      const loginReq = httpMock.expectOne('/api/auth/login');
      loginReq.flush(response);
      tick();

      const meReq = httpMock.expectOne('/api/auth/me');
      meReq.flush(userFromMe);
      tick();

      expect(service.currentUser()).toEqual(userFromMe);
    }));
  });

  describe('logout()', () => {
    it('clears token, resets currentUser, and navigates to /login', fakeAsync(() => {
      localStorage.setItem('contractcanvas_auth_token', 'old-token');
      const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      service.logout();

      expect(service.getToken()).toBeNull();
      expect(service.currentUser()).toBeNull();
      expect(navSpy).toHaveBeenCalledWith(['/login']);
    }));
  });

  describe('register()', () => {
    it('stores token and sets currentUser on successful registration', fakeAsync(() => {
      const user = { id: 'u1', email: 'new@example.com', name: { firstName: 'N', lastName: 'E' }, role: 'CLIENT' as const };
      const response = { token: 'reg-jwt', user };
      const payload: any = {
        email: 'new@example.com', password: 'password123', confirmPassword: 'password123',
        name: { firstName: 'N', lastName: 'E' }, role: 'CLIENT', acceptTerms: true,
        orgMode: 'create', organizationName: 'Acme', organizationSlug: 'acme',
      };

      service.register(payload).subscribe();
      const req = httpMock.expectOne('/api/auth/register?autoLogin=1');
      expect(req.request.method).toBe('POST');
      req.flush(response);
      tick();

      expect(service.getToken()).toBe('reg-jwt');
      expect(service.currentUser()).toEqual(user);
    }));
  });

  describe('getMe()', () => {
    it('returns null and does not make HTTP call when no token', fakeAsync(() => {
      let result: any;
      service.getMe().subscribe(u => (result = u));
      tick();
      httpMock.expectNone('/api/auth/me');
      expect(result).toBeNull();
    }));

    it('fetches /me and sets currentUser', fakeAsync(() => {
      localStorage.setItem('contractcanvas_auth_token', 'valid-token');
      const user = { id: 'u1', email: 'a@b.com', name: { firstName: 'A', lastName: 'B' }, role: 'LAWYER' as const };

      service.getMe().subscribe();
      const req = httpMock.expectOne('/api/auth/me');
      expect(req.request.headers.get('Authorization')).toBe('Bearer valid-token');
      req.flush(user);
      tick();

      expect(service.currentUser()).toEqual(user);
    }));

    it('calls logout and returns null on HTTP error', fakeAsync(() => {
      localStorage.setItem('contractcanvas_auth_token', 'expired-token');
      const logoutSpy = jest.spyOn(service, 'logout');
      jest.spyOn(router, 'navigate').mockResolvedValue(true);
      let result: any = 'not-set';

      service.getMe().subscribe(u => (result = u));
      const req = httpMock.expectOne('/api/auth/me');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      tick();

      expect(logoutSpy).toHaveBeenCalled();
      expect(result).toBeNull();
    }));
  });
});

describe('AuthService constructor with pre-existing token', () => {
  afterEach(() => localStorage.clear());

  it('calls getMe on construction when token already exists', fakeAsync(() => {
    localStorage.setItem('contractcanvas_auth_token', 'boot-token');
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [provideRouter([]), AuthService],
    });
    const svc  = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    const req  = http.expectOne('/api/auth/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer boot-token');
    req.flush({ id: 'u9', email: 'boot@test.com', name: { firstName: 'Boot', lastName: 'User' }, role: 'ADMIN' as const });
    tick();
    expect(svc.currentUser()?.id).toBe('u9');
    http.verify();
  }));
});
