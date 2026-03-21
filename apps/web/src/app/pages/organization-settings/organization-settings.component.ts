import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OrganizationService, OrgMember } from '../../services/organization.service';
import { AuthService } from '../../services/auth.service';
import { WebhookService, OutboundWebhook } from '../../services/webhook.service';
import { ApiKeyService, ApiKey } from '../../services/api-key.service';

@Component({
  selector: 'app-organization-settings',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatTableModule, MatChipsModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatDividerModule, MatTabsModule, MatSlideToggleModule, MatTooltipModule,
  ],
  template: `
    <div class="org-settings-container">
      <h2><mat-icon>business</mat-icon> Organization Settings</h2>

      <div *ngIf="loading()" class="loading-center">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <mat-tab-group *ngIf="!loading()" (selectedTabChange)="onTabChange($event.index)">

        <!-- Members Tab -->
        <mat-tab label="Members">
          <div class="tab-content">
            <table mat-table [dataSource]="members()" class="full-table">
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
                    (click)="removeMember(m)" matTooltip="Remove member">
                    <mat-icon>person_remove</mat-icon>
                  </button>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="memberCols"></tr>
              <tr mat-row *matRowDef="let row; columns: memberCols;"></tr>
            </table>

            <mat-divider></mat-divider>
            <h3>Invite Member</h3>
            <div class="invite-row">
              <mat-form-field appearance="outline" class="invite-email">
                <mat-label>Email address</mat-label>
                <input matInput [formControl]="inviteEmail" type="email" placeholder="colleague@firm.com">
              </mat-form-field>
              <mat-form-field appearance="outline" class="invite-role">
                <mat-label>Role</mat-label>
                <mat-select [formControl]="inviteRole">
                  <mat-option value="MEMBER">Member</mat-option>
                  <mat-option value="ADMIN">Admin</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-raised-button color="primary" [disabled]="inviteEmail.invalid || inviting()" (click)="inviteMember()">
                <mat-icon>person_add</mat-icon> Invite
              </button>
            </div>
          </div>
        </mat-tab>

        <!-- Webhooks Tab -->
        <mat-tab label="Webhooks">
          <div class="tab-content">
            <div *ngIf="webhooksLoading()" class="loading-center"><mat-spinner diameter="32"></mat-spinner></div>
            <ng-container *ngIf="!webhooksLoading()">
              <table *ngIf="webhooks().length > 0" mat-table [dataSource]="webhooks()" class="full-table">
                <ng-container matColumnDef="url">
                  <th mat-header-cell *matHeaderCellDef>URL</th>
                  <td mat-cell *matCellDef="let w" class="mono-sm">{{ w.url }}</td>
                </ng-container>
                <ng-container matColumnDef="events">
                  <th mat-header-cell *matHeaderCellDef>Events</th>
                  <td mat-cell *matCellDef="let w">{{ w.events.join(', ') }}</td>
                </ng-container>
                <ng-container matColumnDef="active">
                  <th mat-header-cell *matHeaderCellDef>Active</th>
                  <td mat-cell *matCellDef="let w">
                    <mat-slide-toggle [checked]="w.isActive" (change)="toggleWebhook(w)"></mat-slide-toggle>
                  </td>
                </ng-container>
                <ng-container matColumnDef="whActions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let w">
                    <button mat-icon-button color="warn" (click)="deleteWebhook(w)" matTooltip="Delete">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="webhookCols"></tr>
                <tr mat-row *matRowDef="let row; columns: webhookCols;"></tr>
              </table>
              <p *ngIf="webhooks().length === 0" class="empty-msg">No webhooks configured.</p>

              <mat-divider></mat-divider>
              <h3>Add Webhook</h3>
              <form [formGroup]="webhookForm" (ngSubmit)="createWebhook()" class="webhook-form">
                <mat-form-field appearance="outline" class="wh-url">
                  <mat-label>Endpoint URL</mat-label>
                  <input matInput formControlName="url" placeholder="https://example.com/webhook">
                </mat-form-field>
                <mat-form-field appearance="outline" class="wh-events">
                  <mat-label>Events</mat-label>
                  <mat-select formControlName="events" multiple>
                    <mat-option *ngFor="let e of availableEvents" [value]="e">{{ e }}</mat-option>
                  </mat-select>
                </mat-form-field>
                <button mat-raised-button color="primary" type="submit" [disabled]="webhookForm.invalid">
                  <mat-icon>add</mat-icon> Create
                </button>
              </form>
              <div *ngIf="newWebhookSecret()" class="secret-box">
                <strong>Webhook secret (copy now — shown only once):</strong>
                <code>{{ newWebhookSecret() }}</code>
              </div>
            </ng-container>
          </div>
        </mat-tab>

        <!-- API Keys Tab -->
        <mat-tab label="API Keys">
          <div class="tab-content">
            <div *ngIf="apiKeysLoading()" class="loading-center"><mat-spinner diameter="32"></mat-spinner></div>
            <ng-container *ngIf="!apiKeysLoading()">
              <table *ngIf="apiKeys().length > 0" mat-table [dataSource]="apiKeys()" class="full-table">
                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef>Name</th>
                  <td mat-cell *matCellDef="let k">{{ k.name }}</td>
                </ng-container>
                <ng-container matColumnDef="prefix">
                  <th mat-header-cell *matHeaderCellDef>Key Prefix</th>
                  <td mat-cell *matCellDef="let k" class="mono-sm">{{ k.prefix }}…</td>
                </ng-container>
                <ng-container matColumnDef="lastUsed">
                  <th mat-header-cell *matHeaderCellDef>Last Used</th>
                  <td mat-cell *matCellDef="let k">{{ k.lastUsedAt ? (k.lastUsedAt | date:'short') : 'Never' }}</td>
                </ng-container>
                <ng-container matColumnDef="keyActions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let k">
                    <button mat-icon-button color="warn" (click)="revokeApiKey(k)" matTooltip="Revoke">
                      <mat-icon>block</mat-icon>
                    </button>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="apiKeyCols"></tr>
                <tr mat-row *matRowDef="let row; columns: apiKeyCols;"></tr>
              </table>
              <p *ngIf="apiKeys().length === 0" class="empty-msg">No API keys created.</p>

              <mat-divider></mat-divider>
              <h3>Generate API Key</h3>
              <div class="invite-row">
                <mat-form-field appearance="outline" class="invite-email">
                  <mat-label>Key name</mat-label>
                  <input matInput [formControl]="apiKeyName" placeholder="CI/CD integration">
                </mat-form-field>
                <button mat-raised-button color="primary" [disabled]="apiKeyName.invalid" (click)="createApiKey()">
                  <mat-icon>vpn_key</mat-icon> Generate
                </button>
              </div>
              <div *ngIf="newRawKey()" class="secret-box">
                <strong>API key (copy now — shown only once):</strong>
                <code>{{ newRawKey() }}</code>
              </div>
            </ng-container>
          </div>
        </mat-tab>

        <!-- Retention Tab -->
        <mat-tab label="Retention">
          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title><mat-icon>schedule</mat-icon> Data Retention Policy</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p>Documents in closed matters older than the retention period will be automatically archived.</p>
                <div class="invite-row">
                  <mat-form-field appearance="outline" class="invite-email">
                    <mat-label>Retention (days)</mat-label>
                    <input matInput type="number" [formControl]="retentionDays" min="30" max="36500">
                    <mat-hint>Default: 2555 days (7 years)</mat-hint>
                  </mat-form-field>
                  <button mat-raised-button color="primary" [disabled]="retentionDays.invalid" (click)="saveRetention()">
                    <mat-icon>save</mat-icon> Save
                  </button>
                </div>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

      </mat-tab-group>
    </div>
  `,
  styles: [`
    .org-settings-container { padding: 24px; max-width: 960px; margin: 0 auto; }
    h2 { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    h3 { margin: 16px 0 8px; font-size: 16px; font-weight: 500; }
    .loading-center { display: flex; justify-content: center; padding: 40px; }
    .tab-content { padding: 16px 0; }
    .full-table { width: 100%; }
    .you-badge { font-size: 12px; color: #888; margin-left: 4px; }
    .invite-row { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .invite-email { flex: 1; min-width: 220px; }
    .invite-role { width: 140px; }
    mat-divider { margin: 16px 0; }
    .mono-sm { font-family: monospace; font-size: 12px; word-break: break-all; }
    .empty-msg { color: #888; font-style: italic; padding: 16px 0; }
    .webhook-form { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .wh-url { flex: 2; min-width: 260px; }
    .wh-events { flex: 1; min-width: 200px; }
    .secret-box {
      margin-top: 12px; padding: 12px; background: #fff3e0; border-radius: 8px; border: 1px solid #ffe0b2;
      word-break: break-all;
    }
    .secret-box code { display: block; margin-top: 4px; font-size: 13px; color: #e65100; }
  `],
})
export class OrganizationSettingsComponent implements OnInit {
  private orgService     = inject(OrganizationService);
  private authService    = inject(AuthService);
  private webhookService = inject(WebhookService);
  private apiKeyService  = inject(ApiKeyService);
  private snack          = inject(MatSnackBar);

  members      = signal<OrgMember[]>([]);
  loading      = signal(false);
  inviting     = signal(false);
  currentOrgId = signal('');

  memberCols = ['name', 'email', 'role', 'actions'];
  inviteEmail = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
  inviteRole  = new FormControl<'MEMBER' | 'ADMIN'>('MEMBER', { nonNullable: true });
  currentUserId = () => (this.authService as any).currentUser?.()?.id ?? '';

  webhooks         = signal<OutboundWebhook[]>([]);
  webhooksLoading  = signal(false);
  newWebhookSecret = signal('');
  webhookCols      = ['url', 'events', 'active', 'whActions'];
  availableEvents  = ['matter.created', 'matter.updated', 'contract.created', 'contract.updated', 'contract.status_changed', 'document.uploaded', 'signature.completed', 'task.completed'];
  webhookForm = new FormGroup({
    url:    new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^https?:\/\/.+/)] }),
    events: new FormControl<string[]>([], { nonNullable: true, validators: [Validators.required] }),
  });

  apiKeys        = signal<ApiKey[]>([]);
  apiKeysLoading = signal(false);
  newRawKey      = signal('');
  apiKeyCols     = ['name', 'prefix', 'lastUsed', 'keyActions'];
  apiKeyName     = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] });

  retentionDays = new FormControl(2555, { nonNullable: true, validators: [Validators.required, Validators.min(30), Validators.max(36500)] });

  ngOnInit(): void {
    this.orgService.getMyOrganizations().subscribe(orgs => {
      if (orgs.length > 0) {
        this.currentOrgId.set(orgs[0].id);
        this.loadMembers();
      }
    });
  }

  onTabChange(index: number): void {
    if (index === 1 && this.webhooks().length === 0) this.loadWebhooks();
    if (index === 2 && this.apiKeys().length === 0)   this.loadApiKeys();
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
    this.orgService.addMember(this.currentOrgId(), { email: this.inviteEmail.value, role: this.inviteRole.value }).subscribe({
      next: member => {
        this.members.update(ms => [...ms, member]);
        this.inviteEmail.reset();
        this.inviting.set(false);
        this.snack.open('Member invited.', 'OK', { duration: 2500 });
      },
      error: err => {
        this.snack.open(err?.error?.message ?? 'Failed to invite member.', 'Dismiss', { duration: 3000 });
        this.inviting.set(false);
      },
    });
  }

  removeMember(member: OrgMember): void {
    this.orgService.removeMember(this.currentOrgId(), member.id).subscribe({
      next:  () => { this.members.update(ms => ms.filter(m => m.id !== member.id)); this.snack.open('Removed.', 'OK', { duration: 2000 }); },
      error: () => this.snack.open('Failed to remove.', 'Dismiss', { duration: 3000 }),
    });
  }

  roleColor(role: string): 'primary' | 'accent' | 'warn' {
    return role === 'OWNER' ? 'warn' : role === 'ADMIN' ? 'accent' : 'primary';
  }

  loadWebhooks(): void {
    this.webhooksLoading.set(true);
    this.webhookService.list(this.currentOrgId()).subscribe({
      next:  res => { this.webhooks.set(res.data); this.webhooksLoading.set(false); },
      error: ()  => this.webhooksLoading.set(false),
    });
  }

  createWebhook(): void {
    if (this.webhookForm.invalid) return;
    const { url, events } = this.webhookForm.getRawValue();
    this.webhookService.create(this.currentOrgId(), { url, events }).subscribe({
      next: res => {
        this.webhooks.update(ws => [res, ...ws]);
        this.newWebhookSecret.set(res.secret);
        this.webhookForm.reset({ url: '', events: [] });
        this.snack.open('Webhook created.', 'OK', { duration: 2500 });
      },
      error: err => this.snack.open(err?.error?.error ?? 'Failed.', 'Dismiss', { duration: 3000 }),
    });
  }

  toggleWebhook(w: OutboundWebhook): void {
    this.webhookService.update(this.currentOrgId(), w.id, { isActive: !w.isActive }).subscribe({
      next: updated => this.webhooks.update(ws => ws.map(x => x.id === updated.id ? updated : x)),
      error: () => this.snack.open('Failed to toggle.', 'Dismiss', { duration: 3000 }),
    });
  }

  deleteWebhook(w: OutboundWebhook): void {
    this.webhookService.remove(this.currentOrgId(), w.id).subscribe({
      next:  () => { this.webhooks.update(ws => ws.filter(x => x.id !== w.id)); this.snack.open('Deleted.', 'OK', { duration: 2000 }); },
      error: () => this.snack.open('Failed.', 'Dismiss', { duration: 3000 }),
    });
  }

  loadApiKeys(): void {
    this.apiKeysLoading.set(true);
    this.apiKeyService.list(this.currentOrgId()).subscribe({
      next:  res => { this.apiKeys.set(res.data); this.apiKeysLoading.set(false); },
      error: ()  => this.apiKeysLoading.set(false),
    });
  }

  createApiKey(): void {
    if (this.apiKeyName.invalid) return;
    this.apiKeyService.create(this.currentOrgId(), this.apiKeyName.value).subscribe({
      next: res => {
        this.apiKeys.update(ks => [res, ...ks]);
        this.newRawKey.set(res.rawKey);
        this.apiKeyName.reset();
        this.snack.open('API key created.', 'OK', { duration: 2500 });
      },
      error: err => this.snack.open(err?.error?.error ?? 'Failed.', 'Dismiss', { duration: 3000 }),
    });
  }

  revokeApiKey(k: ApiKey): void {
    this.apiKeyService.revoke(this.currentOrgId(), k.id).subscribe({
      next:  () => { this.apiKeys.update(ks => ks.filter(x => x.id !== k.id)); this.snack.open('Revoked.', 'OK', { duration: 2000 }); },
      error: () => this.snack.open('Failed.', 'Dismiss', { duration: 3000 }),
    });
  }

  saveRetention(): void {
    if (this.retentionDays.invalid) return;
    this.snack.open(`Retention set to ${this.retentionDays.value} days.`, 'OK', { duration: 2500 });
  }
}
