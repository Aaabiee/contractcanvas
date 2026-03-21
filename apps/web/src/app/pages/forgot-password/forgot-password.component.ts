import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <div class="forgot-wrapper">
      <mat-card class="forgot-card">
        <mat-card-header>
          <mat-card-title>Reset Password</mat-card-title>
          <mat-card-subtitle>Enter your email to receive a reset link</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <ng-container *ngIf="!sent()">
            <form (ngSubmit)="onSubmit()" #f="ngForm">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Email</mat-label>
                <input matInput type="email" [(ngModel)]="email" name="email" required email>
                <mat-icon matPrefix>alternate_email</mat-icon>
              </mat-form-field>
              <div *ngIf="errorMessage()" class="error-msg">{{ errorMessage() }}</div>
              <button mat-raised-button color="primary" type="submit" class="full-width" [disabled]="!f.form.valid || loading()">
                {{ loading() ? 'Sending…' : 'Send Reset Link' }}
              </button>
            </form>
          </ng-container>
          <ng-container *ngIf="sent()">
            <mat-icon color="primary" style="font-size:48px;width:48px;height:48px;display:block;margin:0 auto 12px">mark_email_read</mat-icon>
            <p>If that email is registered, a reset link has been sent. Check your inbox.</p>
          </ng-container>
        </mat-card-content>
        <mat-card-actions>
          <a routerLink="/login" mat-button>Back to Login</a>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    .forgot-wrapper { display:flex; justify-content:center; align-items:center; min-height:100vh; background:#f5f5f5; }
    .forgot-card { padding:16px; max-width:420px; width:100%; }
    mat-card-content { padding-top:16px; }
    .full-width { width:100%; }
    .error-msg { color:#f44336; font-size:13px; margin-bottom:8px; }
  `],
})
export class ForgotPasswordComponent {
  private auth = inject(AuthService);

  email        = '';
  loading      = signal(false);
  sent         = signal(false);
  errorMessage = signal('');

  onSubmit(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.auth.forgotPassword(this.email).subscribe({
      next: () => { this.loading.set(false); this.sent.set(true); },
      error: () => { this.loading.set(false); this.errorMessage.set('Something went wrong. Please try again.'); },
    });
  }
}
