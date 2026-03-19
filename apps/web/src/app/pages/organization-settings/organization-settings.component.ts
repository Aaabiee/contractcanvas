import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { OrganizationService, OrgMember } from '../../services/organization.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-organization-settings',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatTableModule, MatChipsModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatDividerModule,
  ],
  template: `
    <div class="org-settings-container">
      <h2><mat-icon>business</mat-icon> Organization Settings</h2>

      <div *ngIf="loading()" class="loading-center">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <ng-container *ngIf="!loading()">
        <!-- Members Section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title>Members</mat-card-title>
            <mat-card-subtitle>Manage who has access to your organization</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <table mat-table [dataSource]="members()" class="members-table">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let m">
                  {{ m.user.firstName }} {{ m.user.lastName }}
                  <span *ngIf="m.userId === currentUserId()" class="you-badge">(you)</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="email">
                <th mat-header-cell *matHeaderCellDef>Email</th>
                <td mat-cell *matCellDef="let m">{{ m.user.email }}</td>
              </ng-container>
              <ng-container matColumnDef="role">
                <th mat-header-cell *matHeaderCellDef>Role</th>
                <td mat-cell *matCellDef="let m">
                  <mat-chip [color]="roleColor(m.role)" selected>{{ m.role }}</mat-chip>
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let m">
                  <button mat-icon-button color="warn"
                    [disabled]="m.role === 'OWNER' || m.userId === currentUserId()"
                    (click)="removeMember(m)"
                    matTooltip="Remove member">
                    <mat-icon>person_remove</mat-icon>
                  </button>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
            </table>
          </mat-card-content>
        </mat-card>

        <mat-divider></mat-divider>

        <!-- Invite Section -->
        <mat-card class="settings-card">
          <mat-card-header>
            <mat-card-title>Invite Member</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="invite-row">
              <mat-form-field appearance="outline" class="invite-email">
                <mat-label>Email address</mat-label>
                <input matInput [formControl]="inviteEmail" type="email" placeholder="colleague@firm.com">
                <mat-error *ngIf="inviteEmail.hasError('email')">Enter a valid email</mat-error>
              </mat-form-field>
              <mat-form-field appearance="outline" class="invite-role">
                <mat-label>Role</mat-label>
                <mat-select [formControl]="inviteRole">
                  <mat-option value="MEMBER">Member</mat-option>
                  <mat-option value="ADMIN">Admin</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-raised-button color="primary"
                [disabled]="inviteEmail.invalid || inviting()"
                (click)="inviteMember()">
                <mat-spinner *ngIf="inviting()" diameter="18"></mat-spinner>
                <mat-icon *ngIf="!inviting()">person_add</mat-icon>
                Invite
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </ng-container>
    </div>
  `,
  styles: [`
    .org-settings-container { padding: 24px; max-width: 900px; margin: 0 auto; }
    h2 { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
    .loading-center { display: flex; justify-content: center; padding: 40px; }
    .settings-card { margin-bottom: 24px; }
    .members-table { width: 100%; }
    .you-badge { font-size: 12px; color: #888; margin-left: 4px; }
    .invite-row { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .invite-email { flex: 1; min-width: 220px; }
    .invite-role { width: 140px; }
    mat-divider { margin: 24px 0; }
  `],
})
export class OrganizationSettingsComponent implements OnInit {
  private orgService  = inject(OrganizationService);
  private authService = inject(AuthService);
  private snack       = inject(MatSnackBar);

  members     = signal<OrgMember[]>([]);
  loading     = signal(false);
  inviting    = signal(false);
  currentOrgId = signal('');

  displayedColumns = ['name', 'email', 'role', 'actions'];

  inviteEmail = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
  inviteRole  = new FormControl<'MEMBER' | 'ADMIN'>('MEMBER', { nonNullable: true });

  currentUserId = () => (this.authService as any).currentUser?.()?.id ?? '';

  ngOnInit(): void {
    this.orgService.getMyOrganizations().subscribe(orgs => {
      if (orgs.length > 0) {
        this.currentOrgId.set(orgs[0].id);
        this.loadMembers();
      }
    });
  }

  loadMembers(): void {
    this.loading.set(true);
    this.orgService.getMembers(this.currentOrgId()).subscribe({
      next:  members => { this.members.set(members); this.loading.set(false); },
      error: ()      => { this.snack.open('Failed to load members.', 'Dismiss', { duration: 3000 }); this.loading.set(false); },
    });
  }

  inviteMember(): void {
    if (this.inviteEmail.invalid) return;
    this.inviting.set(true);
    this.orgService.addMember(this.currentOrgId(), {
      email: this.inviteEmail.value,
      role:  this.inviteRole.value,
    }).subscribe({
      next: member => {
        this.members.update(ms => [...ms, member]);
        this.inviteEmail.reset();
        this.inviting.set(false);
        this.snack.open('Member invited successfully.', 'OK', { duration: 2500 });
      },
      error: err => {
        this.snack.open(err?.error?.message ?? 'Failed to invite member.', 'Dismiss', { duration: 3000 });
        this.inviting.set(false);
      },
    });
  }

  removeMember(member: OrgMember): void {
    this.orgService.removeMember(this.currentOrgId(), member.id).subscribe({
      next:  ()  => { this.members.update(ms => ms.filter(m => m.id !== member.id)); this.snack.open('Member removed.', 'OK', { duration: 2000 }); },
      error: ()  => this.snack.open('Failed to remove member.', 'Dismiss', { duration: 3000 }),
    });
  }

  roleColor(role: string): 'primary' | 'accent' | 'warn' {
    return role === 'OWNER' ? 'warn' : role === 'ADMIN' ? 'accent' : 'primary';
  }
}
