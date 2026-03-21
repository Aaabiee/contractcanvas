import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../services/auth.service';

type Step = 'VERIFY_EMAIL' | 'CUSTOMIZE_ORG' | 'CREATE_MATTER' | 'INVITE_MEMBER' | 'UPLOAD_DOCUMENT' | 'DONE';

const STEP_ORDER: Step[] = ['VERIFY_EMAIL', 'CUSTOMIZE_ORG', 'CREATE_MATTER', 'INVITE_MEMBER', 'UPLOAD_DOCUMENT', 'DONE'];

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatStepperModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="onboarding-shell">
      <div class="onboarding-header">
        <mat-icon class="brand-icon">gavel</mat-icon>
        <h1>Welcome to ContractCanvas</h1>
        <p>Let's get your workspace set up in a few steps.</p>
      </div>

      <mat-stepper [linear]="false" [selectedIndex]="stepIndex()" (selectionChange)="onStepSelect($event.selectedIndex)">

        <mat-step [completed]="stepIndex() > 0" label="Verify Email">
          <div class="step-body">
            <mat-icon class="step-icon">mark_email_read</mat-icon>
            <p *ngIf="emailVerified()">Your email is verified.</p>
            <p *ngIf="!emailVerified()">Please check your inbox and verify your email address.</p>
            <button mat-raised-button color="primary" [disabled]="!emailVerified()" (click)="advance('CUSTOMIZE_ORG')">
              Continue
            </button>
          </div>
        </mat-step>

        <mat-step [completed]="stepIndex() > 1" label="Organization">
          <div class="step-body">
            <mat-icon class="step-icon">business</mat-icon>
            <p>Your organization is ready. You can customize it later in Settings.</p>
            <button mat-raised-button color="primary" (click)="advance('CREATE_MATTER')">
              Continue
            </button>
          </div>
        </mat-step>

        <mat-step [completed]="stepIndex() > 2" label="First Matter">
          <div class="step-body">
            <mat-icon class="step-icon">work</mat-icon>
            <p>Create your first legal matter to organize contracts and documents.</p>
            <mat-form-field appearance="outline" class="step-field">
              <mat-label>Matter title</mat-label>
              <input matInput [formControl]="matterTitle" placeholder="e.g., Acme Corp NDA">
            </mat-form-field>
            <div class="step-actions">
              <button mat-raised-button color="primary" [disabled]="matterTitle.invalid || saving()" (click)="createMatter()">
                Create Matter
              </button>
              <button mat-button (click)="advance('INVITE_MEMBER')">Skip</button>
            </div>
          </div>
        </mat-step>

        <mat-step [completed]="stepIndex() > 3" label="Invite Team">
          <div class="step-body">
            <mat-icon class="step-icon">group_add</mat-icon>
            <p>Invite a colleague to collaborate.</p>
            <mat-form-field appearance="outline" class="step-field">
              <mat-label>Colleague's email</mat-label>
              <input matInput [formControl]="inviteEmail" type="email" placeholder="colleague@firm.com">
            </mat-form-field>
            <div class="step-actions">
              <button mat-raised-button color="primary" [disabled]="inviteEmail.invalid || saving()" (click)="inviteMember()">
                Send Invite
              </button>
              <button mat-button (click)="advance('UPLOAD_DOCUMENT')">Skip</button>
            </div>
          </div>
        </mat-step>

        <mat-step [completed]="stepIndex() > 4" label="Upload Document">
          <div class="step-body">
            <mat-icon class="step-icon">cloud_upload</mat-icon>
            <p>Upload your first document to get started.</p>
            <div class="step-actions">
              <button mat-raised-button color="primary" (click)="finishOnboarding()">
                Go to Dashboard
              </button>
              <button mat-button (click)="finishOnboarding()">Skip</button>
            </div>
          </div>
        </mat-step>

      </mat-stepper>

      <div class="skip-all">
        <button mat-button color="primary" (click)="finishOnboarding()">Skip setup and go to dashboard</button>
      </div>
    </div>
  `,
  styles: [`
    .onboarding-shell { max-width: 680px; margin: 40px auto; padding: 24px; }
    .onboarding-header { text-align: center; margin-bottom: 32px; }
    .onboarding-header h1 { margin: 8px 0 4px; font-size: 24px; font-weight: 600; }
    .onboarding-header p { color: #666; }
    .brand-icon { font-size: 48px; width: 48px; height: 48px; color: #3f51b5; }
    .step-body { display: flex; flex-direction: column; align-items: center; padding: 24px 0; gap: 12px; text-align: center; }
    .step-icon { font-size: 40px; width: 40px; height: 40px; color: #3f51b5; }
    .step-field { width: 100%; max-width: 360px; }
    .step-actions { display: flex; gap: 12px; align-items: center; }
    .skip-all { text-align: center; margin-top: 24px; }
  `],
})
export class OnboardingComponent implements OnInit {
  private http        = inject(HttpClient);
  private router      = inject(Router);
  private authService = inject(AuthService);
  private snack       = inject(MatSnackBar);

  stepIndex     = signal(0);
  emailVerified = signal(false);
  saving        = signal(false);

  matterTitle = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] });
  inviteEmail = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });

  ngOnInit(): void {
    this.http.get<any>('/api/users/me').subscribe(user => {
      const step: Step = user.onboardingStep ?? 'VERIFY_EMAIL';
      if (step === 'DONE') {
        this.router.navigate(['/dashboard']);
        return;
      }
      const idx = STEP_ORDER.indexOf(step);
      this.stepIndex.set(idx >= 0 ? idx : 0);
      this.emailVerified.set(!!user.emailVerifiedAt);
    });
  }

  onStepSelect(index: number): void {
    this.stepIndex.set(index);
  }

  advance(nextStep: Step): void {
    this.http.patch('/api/users/me/onboarding', { step: nextStep }).subscribe({
      next: () => {
        const idx = STEP_ORDER.indexOf(nextStep);
        this.stepIndex.set(idx >= 0 ? idx : this.stepIndex() + 1);
      },
      error: () => this.snack.open('Failed to update progress.', 'Dismiss', { duration: 3000 }),
    });
  }

  createMatter(): void {
    this.saving.set(true);
    this.http.post('/api/matters', { title: this.matterTitle.value, status: 'OPEN' }).subscribe({
      next: () => {
        this.saving.set(false);
        this.snack.open('Matter created!', 'OK', { duration: 2000 });
        this.advance('INVITE_MEMBER');
      },
      error: () => { this.saving.set(false); this.snack.open('Failed.', 'Dismiss', { duration: 3000 }); },
    });
  }

  inviteMember(): void {
    this.saving.set(true);
    this.http.get<any[]>('/api/organizations/me').subscribe(orgs => {
      if (!orgs?.length) { this.saving.set(false); return; }
      this.http.post(`/api/organizations/${orgs[0].id}/members`, {
        userId: 'invite',
        email: this.inviteEmail.value,
        role: 'MEMBER',
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.snack.open('Invite sent!', 'OK', { duration: 2000 });
          this.advance('UPLOAD_DOCUMENT');
        },
        error: () => {
          this.saving.set(false);
          this.advance('UPLOAD_DOCUMENT');
        },
      });
    });
  }

  finishOnboarding(): void {
    this.http.patch('/api/users/me/onboarding', { step: 'DONE' }).subscribe({
      next:  () => this.router.navigate(['/dashboard']),
      error: () => this.router.navigate(['/dashboard']),
    });
  }
}
