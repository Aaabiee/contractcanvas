// src/app/interceptors/error.interceptor.ts
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router      = inject(Router);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        switch (err.status) {
          case 401:
            // Token expired or invalid — clear session and go to login
            authService.logout();
            break;

          case 403:
            // Forbidden — navigate to dashboard and let the user know
            console.warn('[HTTP 403] Forbidden:', err.url, err.error?.message ?? '');
            router.navigate(['/dashboard']);
            break;

          case 0:
            // Network error / server unreachable
            console.error('[HTTP] Network error or server unreachable:', err.url);
            break;

          default:
            if (err.status >= 500) {
              console.error(`[HTTP ${err.status}] Server error:`, err.url, err.error);
            }
            break;
        }
      }
      return throwError(() => err);
    })
  );
};
