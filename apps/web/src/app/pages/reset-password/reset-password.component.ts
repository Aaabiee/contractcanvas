import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <div class="reset-wrapper">
      <mat-card class="reset-card">
        <mat-card-header>
          <mat-card-title>Set New Password</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <ng-container *ngIf="!done()">
            <form (ngSubmit)="onSubmit()" #f="ngForm">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>New Password</mat-label>
                <input matInput [type]="hidePass ? 'password' : 'text'" [(ngModel)]="newPassword" name="newPassword" required minlength="12">
                <mat-icon matPrefix>lock</mat-icon>
                <button mat-icon-button matSuffix type="button" (click)="hidePass = !hidePass">
                  <mat-icon>{{ hidePass ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Confirm Password</mat-label>
                <input matInput [type]="hideConfirm ? 'password' : 'text'" [(ngModel)]="confirmPassword" name="confirmPassword" required>
                <mat-icon matPrefix>lock_reset</mat-icon>
                <button mat-icon-button matSuffix type="button" (click)="hideConfirm = !hideConfirm">
                  <mat-icon>{{ hideConfirm ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
              <div *ngIf="errorMessage()" class="error-msg">{{ errorMessage() }}</div>
              <button mat-raised-button color="primary" type="submit" class="full-width"
                [disabled]="!f.form.valid || loading() || newPassword !== confirmPassword">
                {{ loading() ? 'Saving…' : 'Reset Password' }}
              </button>
            </form>
          </ng-container>
          <ng-container *ngIf="done()">
            <mat-icon color="primary" style="font-size:48px;width:48px;height:48px;display:block;margin:0 auto 12px">check_circle</mat-icon>
            <p>Password reset successfully. You can now log in with your new password.</p>
            <button mat-raised-button color="primary" routerLink="/login" class="full-width">Go to Login</button>
          </ng-container>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .reset-wrapper { display:flex; justify-content:center; align-items:center; min-height:100vh; background:#f5f5f5; }
    .reset-card { padding:16px; max-width:420px; width:100%; }
    mat-card-content { padding-top:16px; display:flex; flex-direction:column; align-items:center; text-align:center; }
    .full-width { width:100%; }
    .error-msg { color:#f44336; font-size:13px; margin-bottom:8px; align-self:flex-start; }
  `],
})
export class ResetPasswordComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private auth   = inject(AuthService);
  private router = inject(Router);

  private token = '';
  newPassword     = '';
  confirmPassword = '';
  hidePass        = true;
  hideConfirm     = true;
  loading         = signal(false);
  done            = signal(false);
  errorMessage    = signal('');

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.errorMessage.set('Invalid or missing reset token. Please request a new link.');
    } else {
      window.history.replaceState({}, '', '/reset-password');
    }
  }

  onSubmit(): void {
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }
    this.loading.set(true);
    this.errorMessage.set('');
    this.auth.resetPassword(this.token, this.newPassword).subscribe({
      next: () => { this.loading.set(false); this.done.set(true); setTimeout(() => this.router.navigate(['/login']), 3000); },
      error: err => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.error ?? 'Reset failed. The link may have expired.');
      },
    });
  }
}
