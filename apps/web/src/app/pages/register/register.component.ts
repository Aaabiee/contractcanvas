// apps/web/src/app/pages/register/register.component.ts
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService, AppRole, RegisterPayloadCreate, RegisterPayloadJoin } from '../../services/auth.service';

// Angular Material
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatCheckboxModule,
  ],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
})
export class RegisterComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  /* -------- Form model (matches API schema) -------- */
  // account info
  email = '';
  password = '';
  confirmPassword = '';
  role: AppRole = 'CLIENT';
  acceptTerms = false;

  // name
  firstName = '';
  lastName = '';
  displayName = '';

  // org flow toggle
  orgMode: 'create' | 'join' = 'create';

  // create mode fields
  organizationName = '';
  organizationSlug = '';

  // join mode field
  inviteToken = '';

  // UI helpers
  hidePassword = true;
  hideConfirm = true;
  errorMessage = '';

  // convenient list for select
  readonly roles: AppRole[] = ['CLIENT', 'LAWYER', 'PARALEGAL', 'ADMIN'];

  onRegister(): void {
    this.errorMessage = '';

    if (!this.acceptTerms) {
      this.errorMessage = 'You must accept the Terms of Service to continue.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    if (!this.firstName || !this.lastName) {
      this.errorMessage = 'First and Last name are required.';
      return;
    }

    const base = {
      email: this.email.trim().toLowerCase(),
      password: this.password,
      confirmPassword: this.confirmPassword,
      name: {
        firstName: this.firstName.trim(),
        lastName: this.lastName.trim(),
        ...(this.displayName.trim() ? { displayName: this.displayName.trim() } : {}),
      },
      role: this.role,
      acceptTerms: true as const,
    };

    if (this.orgMode === 'create') {
      const payload: RegisterPayloadCreate = {
        ...base,
        orgMode: 'create',
        organizationName: this.organizationName.trim(),
        organizationSlug: this.slugify(this.organizationSlug || this.organizationName),
      };

      this.authService.register(payload).subscribe({
        next: () => {
          // Registered & auto-logged-in; go to app home/dashboard
          this.router.navigateByUrl('/');
        },
        error: (err) => this.handleError(err),
      });
    } else {
      const payload: RegisterPayloadJoin = {
        ...base,
        orgMode: 'join',
        inviteToken: this.inviteToken.trim(),
      };

      this.authService.register(payload).subscribe({
        next: () => {
          this.router.navigateByUrl('/');
        },
        error: (err) => this.handleError(err),
      });
    }
  }

  private handleError(err: any) {
    // backend returns { error, details } for zod; handle common cases
    if (err?.status === 409) {
      this.errorMessage = 'This email is already in use.';
      return;
    }
    const msg =
      err?.error?.message ||
      err?.error?.error ||
      err?.message ||
      'Registration failed. Please try again.';
    this.errorMessage = msg;

    // Highlight schema errors (optional)
    const fieldErrors = err?.error?.details?.fieldErrors;
    if (fieldErrors) {
      const firstKey = Object.keys(fieldErrors)[0];
      const firstErr = fieldErrors[firstKey]?.[0];
      if (firstErr) this.errorMessage = firstErr;
    }
    console.error('Registration failed', err);
  }

  private slugify(s: string): string {
    return s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}