import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { errorInterceptor } from './error.interceptor';
import { AuthService } from '../services/auth.service';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: { logout: jest.Mock };
  let router: Router;

  beforeEach(() => {
    authService = { logout: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        { provide: MatDialog, useValue: { open: jest.fn() } },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('calls authService.logout() on 401', () => {
    http.get('/api/data').subscribe({ error: () => {} });
    const req = httpMock.expectOne('/api/data');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(authService.logout).toHaveBeenCalled();
  });

  it('navigates to /dashboard on 403', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    http.get('/api/data').subscribe({ error: () => {} });
    const req = httpMock.expectOne('/api/data');
    req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(navSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('re-throws the error after 401 handling', () => {
    let thrownError: HttpErrorResponse | undefined;
    http.get('/api/data').subscribe({ error: err => (thrownError = err) });
    const req = httpMock.expectOne('/api/data');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(thrownError!.status).toBe(401);
  });

  it('re-throws the error after 403 handling', () => {
    let thrownError: HttpErrorResponse | undefined;
    http.get('/api/data').subscribe({ error: err => (thrownError = err) });
    const req = httpMock.expectOne('/api/data');
    req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(thrownError!.status).toBe(403);
  });

  it('re-throws 500 errors without special handling', () => {
    let thrownError: HttpErrorResponse | undefined;
    http.get('/api/data').subscribe({ error: err => (thrownError = err) });
    const req = httpMock.expectOne('/api/data');
    req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
    expect(thrownError!.status).toBe(500);
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not call logout on non-401 errors', () => {
    http.get('/api/data').subscribe({ error: () => {} });
    const req = httpMock.expectOne('/api/data');
    req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('handles network error (status 0) without calling logout', () => {
    let thrownError: any;
    http.get('/api/data').subscribe({ error: err => (thrownError = err) });
    const req = httpMock.expectOne('/api/data');
    req.flush(null, { status: 0, statusText: 'Unknown Error' });
    expect(authService.logout).not.toHaveBeenCalled();
    expect(thrownError).toBeTruthy();
  });

  it('opens upgrade dialog on 402 and re-throws error', () => {
    let thrownError: HttpErrorResponse | undefined;
    http.get('/api/data').subscribe({ error: err => (thrownError = err) });
    const req = httpMock.expectOne('/api/data');
    req.flush({ error: 'LIMIT_EXCEEDED', limit: 5, current: 5 }, { status: 402, statusText: 'Payment Required' });
    expect(thrownError!.status).toBe(402);
    expect(authService.logout).not.toHaveBeenCalled();
  });
});
