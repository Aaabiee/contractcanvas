import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { jwtInterceptor } from './jwt.interceptor';
import { AuthService } from '../services/auth.service';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: { isLoggedIn: jest.Mock; getToken: jest.Mock };

  beforeEach(() => {
    authService = { isLoggedIn: jest.fn(), getToken: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('adds Authorization header for /api requests when logged in', () => {
    authService.isLoggedIn.mockReturnValue(true);
    authService.getToken.mockReturnValue('my-jwt');

    http.get('/api/matters').subscribe();

    const req = httpMock.expectOne('/api/matters');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-jwt');
    req.flush([]);
  });

  it('does not add Authorization header when not logged in', () => {
    authService.isLoggedIn.mockReturnValue(false);
    authService.getToken.mockReturnValue(null);

    http.get('/api/matters').subscribe();

    const req = httpMock.expectOne('/api/matters');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush([]);
  });

  it('does not add Authorization header for non-/api URLs even when logged in', () => {
    authService.isLoggedIn.mockReturnValue(true);
    authService.getToken.mockReturnValue('my-jwt');

    http.get('/external/resource').subscribe();

    const req = httpMock.expectOne('/external/resource');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush({});
  });

  it('forwards the request unchanged when not modifying', () => {
    authService.isLoggedIn.mockReturnValue(false);
    authService.getToken.mockReturnValue(null);

    http.get('/api/data').subscribe();

    const req = httpMock.expectOne('/api/data');
    expect(req.request.url).toBe('/api/data');
    req.flush({});
  });
});
