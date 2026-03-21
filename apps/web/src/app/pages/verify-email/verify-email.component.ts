import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink, MatCardModule, MatButtonModule, MatProgressSpinnerModule, MatIconModule],
  template: `
    <div class="verify-wrapper">
      <mat-card class="verify-card">
        <mat-card-content>
          <ng-container *ngIf="status() === 'loading'">
            <mat-spinner diameter="48" style="margin:0 auto 16px"></mat-spinner>
            <p>Verifying your email…</p>
          </ng-container>

          <ng-container *ngIf="status() === 'success'">
            <mat-icon color="primary" style="font-size:48px;width:48px;height:48px">check_circle</mat-icon>
            <h2>Email verified!</h2>
            <p>Your email address has been confirmed.</p>
            <button mat-raised-button color="primary" routerLink="/dashboard">Go to Dashboard</button>
          </ng-container>

          <ng-container *ngIf="status() === 'already'">
            <mat-icon color="primary" style="font-size:48px;width:48px;height:48px">check_circle</mat-icon>
            <h2>Already verified</h2>
            <p>Your email is already confirmed.</p>
            <button mat-raised-button color="primary" routerLink="/dashboard">Go to Dashboard</button>
          </ng-container>

          <ng-container *ngIf="status() === 'error'">
            <mat-icon color="warn" style="font-size:48px;width:48px;height:48px">error</mat-icon>
            <h2>Verification failed</h2>
            <p>{{ errorMessage() }}</p>
            <button mat-raised-button routerLink="/login">Back to Login</button>
          </ng-container>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .verify-wrapper { display:flex; justify-content:center; align-items:center; min-height:100vh; background:#f5f5f5; }
    .verify-card { padding:32px; text-align:center; max-width:400px; width:100%; }
    mat-card-content { display:flex; flex-direction:column; align-items:center; gap:12px; }
  `],
})
export class VerifyEmailComponent implements OnInit {
  private route   = inject(ActivatedRoute);
  private auth    = inject(AuthService);
  private router  = inject(Router);

  status       = signal<'loading' | 'success' | 'already' | 'error'>('loading');
  errorMessage = signal('');

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!token) {
      this.errorMessage.set('No verification token provided.');
      this.status.set('error');
      return;
    }

    this.auth.verifyEmail(token).subscribe({
      next: res => {
        if (res.token) {
          this.status.set('success');
          setTimeout(() => this.router.navigate(['/dashboard']), 2000);
        } else {
          this.status.set('already');
        }
      },
      error: err => {
        this.errorMessage.set(err?.error?.error ?? 'Verification link is invalid or has expired.');
        this.status.set('error');
      },
    });
  }
}
