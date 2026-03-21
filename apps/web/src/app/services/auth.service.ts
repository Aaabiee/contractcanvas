import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, timer, Subscription } from 'rxjs';
import { tap, switchMap, map, catchError } from 'rxjs/operators';
import { Router } from '@angular/router';

export type AppRole = 'ADMIN' | 'LAWYER' | 'PARALEGAL' | 'CLIENT';

export interface PublicName {
  firstName: string;
  lastName:  string;
  displayName?: string;
}

export interface User {
  id:             string;
  email:          string;
  name:           PublicName;
  role:           AppRole;
  picture?:       string;
  timezone?:      string;
  emailVerified?: boolean;
}

export interface RegisterResponse {
  user:  User;
  token: string;
}

export interface AuthResponse {
  token:  string;
  user?:  User;
}

export interface RegisterPayloadCreate {
  email:            string;
  password:         string;
  confirmPassword:  string;
  name:             PublicName;
  role:             AppRole;
  acceptTerms:      true;
  orgMode:          'create';
  organizationName: string;
  organizationSlug: string;
  phone?:           string;
  picture?:         string;
  timezone?:        string;
  marketingOptIn?:  boolean;
  captchaToken?:    string;
  redirectTo?:      string;
  metadata?:        Record<string, unknown>;
}

export interface RegisterPayloadJoin {
  email:           string;
  password:        string;
  confirmPassword: string;
  name:            PublicName;
  role:            AppRole;
  acceptTerms:     true;
  orgMode:         'join';
  inviteToken:     string;
  phone?:          string;
  picture?:        string;
  timezone?:       string;
  marketingOptIn?: boolean;
  captchaToken?:   string;
  redirectTo?:     string;
  metadata?:       Record<string, unknown>;
}

export type RegisterPayload = RegisterPayloadCreate | RegisterPayloadJoin;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http   = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly apiUrl = '/api/auth';

  /**
   * In-memory access token — never written to localStorage.
   * Lost on page reload, recovered by silentRefresh() via the httpOnly cookie.
   */
  private _token = signal<string | null>(null);

  public currentUser = signal<User | null>(null);

  private refreshTimer: Subscription | null = null;

  constructor() {
    // On every app boot, attempt a silent token refresh using the
    // httpOnly cookie set by the server. Redirects to /login if no
    // valid session exists.
    this.silentRefresh().subscribe();
  }

  // ── public API ────────────────────────────────────────────────────────

  login(credentials: { email: string; password: string }): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/login`, credentials, { withCredentials: true })
      .pipe(
        tap(res => {
          this._token.set(res.token);
          this.scheduleRefresh(res.token);
          if (res.user) this.currentUser.set(res.user);
        }),
        switchMap(res => {
          if (!res.user) {
            return this.getMe().pipe(map(() => res));
          }
          return of(res);
        }),
      );
  }

  register(payload: RegisterPayload): Observable<RegisterResponse> {
    return this.http
      .post<RegisterResponse>(`${this.apiUrl}/register?autoLogin=1`, payload, { withCredentials: true })
      .pipe(
        tap(res => {
          if (res.token) {
            this._token.set(res.token);
            this.scheduleRefresh(res.token);
          }
          if (res.user) this.currentUser.set(res.user);
        }),
      );
  }

  logout(): void {
    this.cancelRefreshTimer();
    this._token.set(null);
    this.currentUser.set(null);
    // Tell the server to delete the session and clear the cookie.
    this.http
      .post(`${this.apiUrl}/logout`, {}, { withCredentials: true })
      .subscribe({ error: () => {} }); // fire-and-forget; ignore errors
    this.router.navigate(['/login']);
  }

  getMe(): Observable<User | null> {
    if (!this._token()) return of(null);
    return this.http.get<User>(`${this.apiUrl}/me`).pipe(
      tap(user => this.currentUser.set(user)),
      catchError(() => {
        this.logout();
        return of(null);
      }),
    );
  }

  getToken(): string | null {
    return this._token();
  }

  isLoggedIn(): boolean {
    return !!this._token();
  }

  emailVerified(): boolean {
    return !!(this.currentUser() as any)?.emailVerified;
  }

  verifyEmail(token: string): Observable<{ ok: boolean; token?: string }> {
    return this.http.get<{ ok: boolean; token?: string }>(
      `${this.apiUrl}/verify-email?token=${encodeURIComponent(token)}`,
      { withCredentials: true },
    ).pipe(
      tap(res => {
        if (res.token) {
          this._token.set(res.token);
          this.scheduleRefresh(res.token);
        }
      }),
      switchMap(res => {
        if (res.token) return this.getMe().pipe(map(() => res));
        return of(res);
      }),
    );
  }

  resendVerification(email: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.apiUrl}/resend-verification`,
      { email },
      { withCredentials: true },
    );
  }

  forgotPassword(email: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.apiUrl}/forgot-password`,
      { email },
    );
  }

  resetPassword(token: string, newPassword: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.apiUrl}/reset-password`,
      { token, newPassword },
    );
  }

  // ── private helpers ──────────────────────────────────────────────────

  /**
   * Calls POST /api/auth/refresh-token (which reads the httpOnly cookie).
   * On success: stores new access token + reschedules next refresh.
   * On failure: clears session state (user must log in again).
   */
  private silentRefresh(): Observable<boolean> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/refresh-token`, {}, { withCredentials: true })
      .pipe(
        tap(res => {
          this._token.set(res.token);
          this.scheduleRefresh(res.token);
        }),
        switchMap(() => this.getMe()),
        map(() => true),
        catchError(() => {
          this._token.set(null);
          this.currentUser.set(null);
          return of(false);
        }),
      );
  }

  /**
   * Schedules the next silent refresh 60 seconds before the JWT expires.
   * Reads the `exp` claim directly from the token without a library.
   */
  private scheduleRefresh(token: string): void {
    this.cancelRefreshTimer();
    try {
      const payload   = JSON.parse(atob(token.split('.')[1]));
      const expiresMs = payload.exp * 1000;
      const refreshIn = expiresMs - Date.now() - 60_000; // 60 s buffer
      if (refreshIn <= 0) {
        this.silentRefresh().subscribe();
        return;
      }
      this.refreshTimer = timer(refreshIn)
        .pipe(switchMap(() => this.silentRefresh()))
        .subscribe();
    } catch {
      // Malformed token — log out
      this.logout();
    }
  }

  private cancelRefreshTimer(): void {
    this.refreshTimer?.unsubscribe();
    this.refreshTimer = null;
  }
}
