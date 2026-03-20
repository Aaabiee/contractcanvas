import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService, AppRole, RegisterPayloadCreate, RegisterPayloadJoin } from '../../services/auth.service';

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

  email = '';
  password = '';
  confirmPassword = '';
  role: AppRole = 'CLIENT';
  acceptTerms = false;

  firstName = '';
  lastName = '';
  displayName = '';

  orgMode: 'create' | 'join' = 'create';

  organizationName = '';
  organizationSlug = '';

  inviteToken = '';

  hidePassword = true;
  hideConfirm = true;
  errorMessage = '';
  loading = false;

  readonly roles: AppRole[] = ['CLIENT', 'LAWYER', 'PARALEGAL', 'ADMIN'];

  get passwordErrors(): string[] {
    const p = this.password;
    const errors: string[] = [];
    if (p.length > 0 && p.length < 8)      errors.push('At least 8 characters');
    if (p.length > 0 && !/[A-Z]/.test(p))  errors.push('One uppercase letter');
    if (p.length > 0 && !/[a-z]/.test(p))  errors.push('One lowercase letter');
    if (p.length > 0 && !/[0-9]/.test(p))  errors.push('One number');
    if (p.length > 0 && !/[^A-Za-z0-9]/.test(p)) errors.push('One special character');
    return errors;
  }

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

      this.loading = true;
      this.authService.register(payload).subscribe({
        next: () => {
          this.loading = false;
          this.router.navigateByUrl('/');
        },
        error: (err) => { this.loading = false; this.handleError(err); },
      });
    } else {
      const payload: RegisterPayloadJoin = {
        ...base,
        orgMode: 'join',
        inviteToken: this.inviteToken.trim(),
      };

      this.loading = true;
      this.authService.register(payload).subscribe({
        next: () => {
          this.loading = false;
          this.router.navigateByUrl('/');
        },
        error: (err) => { this.loading = false; this.handleError(err); },
      });
    }
  }

  private handleError(err: any) {
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
