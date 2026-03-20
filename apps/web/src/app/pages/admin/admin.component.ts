import {
  Component, ChangeDetectionStrategy, inject, signal, OnInit, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { OrganizationService, OrgMember } from '../../services/organization.service';
import { MatterService } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatTableModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatDividerModule, MatTooltipModule,
  ],
  template: `
    <div class="page-shell">

      <!-- Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Admin</h1>
          <p class="page-sub">Manage your organization, members, and workspace</p>
        </div>
      </div>

      <!-- Loading -->
      <div *ngIf="loading()" class="center-spinner">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <ng-container *ngIf="!loading()">

        <!-- Stat Cards -->
        <section class="stats-row">
          <mat-card class="stat-card">
            <div class="stat-inner">
              <mat-icon class="stat-icon primary">group</mat-icon>
              <div>
                <div class="stat-value">{{ members().length }}</div>
                <div class="stat-label">Members</div>
              </div>
            </div>
          </mat-card>
          <mat-card class="stat-card">
            <div class="stat-inner">
              <mat-icon class="stat-icon accent">work</mat-icon>
              <div>
                <div class="stat-value">{{ openMatters() }}</div>
                <div class="stat-label">Open Matters</div>
              </div>
            </div>
          </mat-card>
          <mat-card class="stat-card">
            <div class="stat-inner">
              <mat-icon class="stat-icon warn">description</mat-icon>
              <div>
                <div class="stat-value">{{ totalContracts() }}</div>
                <div class="stat-label">Contracts</div>
              </div>
            </div>
          </mat-card>
          <mat-card class="stat-card">
            <div class="stat-inner">
              <mat-icon class="stat-icon primary">business</mat-icon>
              <div>
                <div class="stat-value">{{ orgName() }}</div>
                <div class="stat-label">Organization</div>
              </div>
            </div>
          </mat-card>
        </section>

        <!-- Members Table -->
        <mat-card class="section-card">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>people</mat-icon> Members
            </mat-card-title>
            <mat-card-subtitle>{{ members().length }} members in this organization</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <table mat-table [dataSource]="members()" class="members-table">

              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let m">
                  <div class="member-name">
                    {{ m.user.firstName }} {{ m.user.lastName }}
                    <span *ngIf="m.userId === currentUserId()" class="you-tag">you</span>
                  </div>
                  <div class="member-email">{{ m.user.email }}</div>
                </td>
              </ng-container>

              <ng-container matColumnDef="role">
                <th mat-header-cell *matHeaderCellDef>Role</th>
                <td mat-cell *matCellDef="let m">
                  <mat-chip [class]="'role-chip role-' + m.role.toLowerCase()" disableRipple>
                    {{ m.role }}
                  </mat-chip>
                </td>
              </ng-container>

              <ng-container matColumnDef="since">
                <th mat-header-cell *matHeaderCellDef>Member Since</th>
                <td mat-cell *matCellDef="let m" class="date-cell">
                  {{ m.createdAt | date:'MMM d, y' }}
                </td>
              </ng-container>

              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef><span class="sr-only">Actions</span></th>
                <td mat-cell *matCellDef="let m" class="actions-cell">
                  <button mat-icon-button color="warn"
                    matTooltip="Remove member"
                    [disabled]="m.role === 'OWNER' || m.userId === currentUserId()"
                    (click)="removeMember(m)">
                    <mat-icon>person_remove</mat-icon>
                  </button>
                </td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="memberCols"></tr>
              <tr mat-row *matRowDef="let row; columns: memberCols;"></tr>
            </table>
          </mat-card-content>
        </mat-card>

        <mat-divider></mat-divider>

        <!-- Invite Member -->
        <mat-card class="section-card">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>person_add</mat-icon> Invite Member
            </mat-card-title>
            <mat-card-subtitle>Send an invitation to join your organization</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="inviteForm" (ngSubmit)="inviteMember()" class="invite-form">
              <mat-form-field appearance="outline" class="invite-email">
                <mat-label>Email address</mat-label>
                <input matInput formControlName="email" type="email" placeholder="colleague@firm.com">
                <mat-icon matPrefix>email</mat-icon>
                <mat-error *ngIf="inviteForm.get('email')?.hasError('email')">Enter a valid email</mat-error>
                <mat-error *ngIf="inviteForm.get('email')?.hasError('required')">Email is required</mat-error>
              </mat-form-field>
              <mat-form-field appearance="outline" class="invite-role">
                <mat-label>Role</mat-label>
                <mat-select formControlName="role">
                  <mat-option value="MEMBER">Member</mat-option>
                  <mat-option value="ADMIN">Admin</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-raised-button color="primary" type="submit"
                [disabled]="inviteForm.invalid || inviting()">
                <mat-spinner *ngIf="inviting()" diameter="18" class="inline-spinner"></mat-spinner>
                <mat-icon *ngIf="!inviting()">send</mat-icon>
                {{ inviting() ? 'Inviting…' : 'Send Invite' }}
              </button>
            </form>
          </mat-card-content>
        </mat-card>

      </ng-container>
    </div>
  `,
  styles: [`
    .page-shell  { padding: 24px; max-width: 1000px; margin: 0 auto; }
    .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
    .page-title  { margin: 0; font-size: 24px; font-weight: 600; }
    .page-sub    { margin: 4px 0 0; color: #666; font-size: 13px; }

    .center-spinner { display: flex; justify-content: center; padding: 48px; }

    /* Stats */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card   { padding: 4px; }
    .stat-inner  { display: flex; align-items: center; gap: 16px; padding: 12px 8px; }
    .stat-icon   { font-size: 36px; width: 36px; height: 36px; }
    .stat-icon.primary { color: #1976d2; }
    .stat-icon.accent  { color: #f57c00; }
    .stat-icon.warn    { color: #d32f2f; }
    .stat-value  { font-size: 26px; font-weight: 700; line-height: 1; }
    .stat-label  { font-size: 13px; color: #666; margin-top: 2px; }

    /* Members */
    .section-card    { margin-bottom: 24px; }
    mat-card-title   { display: flex; align-items: center; gap: 8px; }
    .members-table   { width: 100%; }
    .member-name     { font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 6px; }
    .member-email    { font-size: 12px; color: #888; }
    .you-tag         { background: #e3f2fd; color: #1565c0; font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
    .date-cell       { color: #777; font-size: 13px; white-space: nowrap; }
    .actions-cell    { white-space: nowrap; }

    .role-chip { font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 12px; }
    .role-chip.role-owner  { background: #fce4ec; color: #880e4f; }
    .role-chip.role-admin  { background: #e8eaf6; color: #3949ab; }
    .role-chip.role-member { background: #e8f5e9; color: #2e7d32; }

    mat-divider { margin: 8px 0 24px; }

    /* Invite form */
    .invite-form  { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .invite-email { flex: 1; min-width: 240px; }
    .invite-role  { width: 150px; }
    .inline-spinner { display: inline-block; margin-right: 8px; vertical-align: middle; }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }
  `],
})
export class AdminComponent implements OnInit {
  private orgService    = inject(OrganizationService);
  private matterService = inject(MatterService);
  private contractService = inject(ContractService);
  private authService   = inject(AuthService);
  private snack         = inject(MatSnackBar);

  loading       = signal(true);
  inviting      = signal(false);
  members       = signal<OrgMember[]>([]);
  openMatters   = signal(0);
  totalContracts = signal(0);
  orgName       = signal('—');
  orgId         = signal('');

  memberCols = ['name', 'role', 'since', 'actions'];

  currentUserId = computed(() => this.authService.currentUser()?.id ?? '');

  inviteForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    role:  new FormControl<'MEMBER' | 'ADMIN'>('MEMBER', { nonNullable: true }),
  });

  ngOnInit(): void {
    this.orgService.getMyOrganizations().pipe(
      catchError(() => of([]))
    ).subscribe(orgs => {
      if (!orgs.length) { this.loading.set(false); return; }
      const org = orgs[0];
      this.orgName.set(org.name);
      this.orgId.set(org.id);

      forkJoin({
        members:   this.orgService.getMembers(org.id).pipe(catchError(() => of([]))),
        matters:   this.matterService.getMatters({ status: 'OPEN', limit: 1 }).pipe(
                     catchError(() => of({ data: [], total: 0, limit: 1, offset: 0 }))),
        contracts: this.contractService.getContracts().pipe(
                     catchError(() => of({ data: [], total: 0, limit: 1, offset: 0 }))),
      }).subscribe(({ members, matters, contracts }) => {
        this.members.set(members as OrgMember[]);
        this.openMatters.set((matters as any).total ?? 0);
        this.totalContracts.set((contracts as any).total ?? 0);
        this.loading.set(false);
      });
    });
  }

  inviteMember(): void {
    if (this.inviteForm.invalid || !this.orgId()) return;
    this.inviting.set(true);
    this.orgService.addMember(this.orgId(), {
      email: this.inviteForm.getRawValue().email,
      role:  this.inviteForm.getRawValue().role,
    }).subscribe({
      next: member => {
        this.members.update(ms => [...ms, member]);
        this.inviteForm.reset({ email: '', role: 'MEMBER' });
        this.inviting.set(false);
        this.snack.open('Member invited successfully.', 'OK', { duration: 2500 });
      },
      error: err => {
        this.snack.open(err?.error?.message ?? 'Failed to invite member.', 'Dismiss', { duration: 4000 });
        this.inviting.set(false);
      },
    });
  }

  removeMember(member: OrgMember): void {
    const ref = this.snack.open(
      `Remove ${member.user.firstName} ${member.user.lastName}?`, 'Remove', { duration: 5000 });
    ref.onAction().subscribe(() => {
      this.orgService.removeMember(this.orgId(), member.id).subscribe({
        next: () => {
          this.members.update(ms => ms.filter(m => m.id !== member.id));
          this.snack.open('Member removed.', 'OK', { duration: 2500 });
        },
        error: () => this.snack.open('Failed to remove member.', 'Dismiss', { duration: 3000 }),
      });
    });
  }
}
