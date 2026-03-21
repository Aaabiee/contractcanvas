import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router      = inject(Router);
  const authService = inject(AuthService);
  const dialog      = inject(MatDialog);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        switch (err.status) {
          case 401:
            authService.logout();
            break;

          case 402: {
            const body = err.error ?? {};
            import('../components/upgrade-dialog/upgrade-dialog.component').then(m => {
              dialog.open(m.UpgradeDialogComponent, {
                width: '420px',
                data: {
                  error:   body.error ?? 'LIMIT_EXCEEDED',
                  limit:   body.limit,
                  current: body.current,
                },
              });
            });
            break;
          }

          case 403:
            console.warn('[HTTP 403] Forbidden:', err.url, err.error?.message ?? '');
            router.navigate(['/dashboard']);
            break;

          case 0:
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
