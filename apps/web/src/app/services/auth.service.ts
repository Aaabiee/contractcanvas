import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Router } from '@angular/router';

/* ================== Types ================== */

export type AppRole = 'ADMIN' | 'LAWYER' | 'PARALEGAL' | 'CLIENT';

export interface PublicName {
  firstName: string;
  lastName: string;
  displayName?: string;
}

export interface User {
  id: string;
  email: string;
  name: PublicName;
  role: AppRole;
  picture?: string;
  timezone?: string;
}

export interface RegisterResponse {
  user: User;
  token: string;
}

export interface AuthResponse {
  token: string;
  user?: User; // some APIs also return user on login
}

/** Registration payloads (must match API) */
export interface RegisterPayloadCreate {
  email: string;
  password: string;
  confirmPassword: string;
  name: PublicName;
  role: AppRole;                 // default CLIENT is fine
  acceptTerms: true;             // must be true per schema
  orgMode: 'create';
  organizationName: string;
  organizationSlug: string;      // lowercase/slug
  // optional fields
  phone?: string;
  picture?: string;
  timezone?: string;
  marketingOptIn?: boolean;
  captchaToken?: string;
  redirectTo?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterPayloadJoin {
  email: string;
  password: string;
  confirmPassword: string;
  name: PublicName;
  role: AppRole;
  acceptTerms: true;
  orgMode: 'join';
  inviteToken: string;
  // optional
  phone?: string;
  picture?: string;
  timezone?: string;
  marketingOptIn?: boolean;
  captchaToken?: string;
  redirectTo?: string;
  metadata?: Record<string, unknown>;
}

export type RegisterPayload = RegisterPayloadCreate | RegisterPayloadJoin;

/* ================== Service ================== */

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  /** With Angular dev proxy, this routes to API (:3333) */
  private apiUrl = '/api/auth';
  private tokenKey = 'contractcanvas_auth_token';

  public currentUser = signal<User | null>(null);

  constructor() {
    if (this.isLoggedIn()) {
      this.getMe().subscribe();
    }
  }

  /* ---------- Auth calls ---------- */

  register(payload: RegisterPayload): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/register`, payload).pipe(
      tap((res) => {
        // API returns a token on successful registration; auto-login
        this.storeToken(res.token);
        this.currentUser.set(res.user);
      })
    );
  }

  login(credentials: { email: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, credentials).pipe(
      tap((response) => {
        this.storeToken(response.token);
        // If user is included, set it; otherwise fetch /me
        if (response.user) {
          this.currentUser.set(response.user);
        } else {
          this.getMe().subscribe();
        }
      })
    );
  }

  getMe(): Observable<User | null> {
    const headers = this.getAuthHeaders();
    if (!headers) {
      return of(null);
    }
    return this.http.get<User>(`${this.apiUrl}/me`, { headers }).pipe(
      tap((user) => this.currentUser.set(user)),
      catchError((error) => {
        console.error('Failed to fetch user', error);
        this.logout();
        return of(null);
      })
    );
  }

  /* ---------- Helpers ---------- */

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  private storeToken(token: string): void {
    localStorage.setItem(this.tokenKey, token);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  private getAuthHeaders(): HttpHeaders | null {
    const token = this.getToken();
    if (!token) return null;
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}