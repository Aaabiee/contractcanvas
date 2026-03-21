import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const auth  = inject(AuthService);
  const token = auth.getToken();

  if (!req.url.startsWith('/api')) {
    return next(req);
  }

  // Always send cookies with API requests (needed for httpOnly refresh cookie
  // in dev where the Angular dev server runs on a different port to the API).
  let cloned = req.clone({ withCredentials: true });

  if (token) {
    cloned = cloned.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(cloned);
};
