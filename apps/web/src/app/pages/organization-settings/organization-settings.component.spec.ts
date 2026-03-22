import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrganizationSettingsComponent } from './organization-settings.component';
import { OrganizationService } from '../../services/organization.service';
import { AuthService } from '../../services/auth.service';
import { WebhookService } from '../../services/webhook.service';
import { ApiKeyService } from '../../services/api-key.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { WebhookService } from '../../services/webhook.service';
import { ApiKeyService } from '../../services/api-key.service';

const mockOrgs = [{ id: 'org-1', name: 'Acme Law', slug: 'acme-law', createdAt: new Date().toISOString() }];
const mockMembers = [
  { id: 'mem-1', organizationId: 'org-1', userId: 'user-1', role: 'OWNER' as const, createdAt: new Date().toISOString(),
    user: { id: 'user-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@acme.com' } },
  { id: 'mem-2', organizationId: 'org-1', userId: 'user-2', role: 'MEMBER' as const, createdAt: new Date().toISOString(),
    user: { id: 'user-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@acme.com' } },
];

describe('OrganizationSettingsComponent', () => {
  let fixture: ComponentFixture<OrganizationSettingsComponent>;
  let component: OrganizationSettingsComponent;
  let orgService: jest.Mocked<OrganizationService>;
  let snackMock: { open: jest.Mock };

  beforeEach(async () => {
    const orgServiceMock = {
      getMyOrganizations: jest.fn().mockReturnValue(of(mockOrgs)),
      getMembers:         jest.fn().mockReturnValue(of(mockMembers)),
      addMember:          jest.fn(),
      removeMember:       jest.fn(),
      updateMember:       jest.fn(),
    };
    const authServiceMock = { currentUser: () => ({ id: 'user-1' }) };
    snackMock = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [OrganizationSettingsComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimations(),
        { provide: OrganizationService, useValue: orgServiceMock },
        { provide: AuthService,         useValue: authServiceMock },
        { provide: WebhookService,     useValue: { list: jest.fn().mockReturnValue(of({ data: [] })), create: jest.fn(), update: jest.fn(), remove: jest.fn() } },
        { provide: ApiKeyService,      useValue: { list: jest.fn().mockReturnValue(of({ data: [] })), create: jest.fn(), revoke: jest.fn() } },
      ],
    })
      .overrideComponent(OrganizationSettingsComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackMock }] },
      })
      .compileComponents();

    orgService = TestBed.inject(OrganizationService) as jest.Mocked<OrganizationService>;
    fixture    = TestBed.createComponent(OrganizationSettingsComponent);
    component  = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('should load members on init', () => {
    expect(orgService.getMyOrganizations).toHaveBeenCalled();
    expect(orgService.getMembers).toHaveBeenCalledWith('org-1');
    expect(component.members()).toHaveLength(2);
  });

  it('should not call loadMembers when no orgs returned', async () => {
    orgService.getMyOrganizations.mockReturnValue(of([]));
    orgService.getMembers.mockClear();
    component.ngOnInit();
    expect(orgService.getMembers).not.toHaveBeenCalled();
  });

  it('should show snackbar on loadMembers error', () => {
    orgService.getMembers.mockReturnValue(throwError(() => new Error('fail')));
    component.loadMembers();
    expect(snackMock.open).toHaveBeenCalledWith('Failed to load members.', 'Dismiss', expect.any(Object));
    expect(component.loading()).toBe(false);
  });

  it('should invite a member', () => {
    const newMember = { ...mockMembers[1], id: 'mem-3', userId: 'user-3' };
    orgService.addMember.mockReturnValue(of(newMember));
    component.inviteEmail.setValue('new@acme.com');
    component.inviteRole.setValue('MEMBER');
    component.inviteMember();
    expect(orgService.addMember).toHaveBeenCalledWith('org-1', { email: 'new@acme.com', role: 'MEMBER' });
    expect(snackMock.open).toHaveBeenCalledWith('Member invited.', 'OK', expect.any(Object));
    expect(component.inviting()).toBe(false);
  });

  it('should not call addMember when inviteEmail is invalid', () => {
    component.inviteEmail.setValue('not-an-email');
    component.inviteMember();
    expect(orgService.addMember).not.toHaveBeenCalled();
  });

  it('should show error with server message when invite fails', () => {
    orgService.addMember.mockReturnValue(throwError(() => ({ error: { message: 'Already a member' } })));
    component.inviteEmail.setValue('existing@acme.com');
    component.inviteMember();
    expect(snackMock.open).toHaveBeenCalledWith('Already a member', 'Dismiss', expect.any(Object));
    expect(component.inviting()).toBe(false);
  });

  it('should use fallback message when invite fails without server message', () => {
    orgService.addMember.mockReturnValue(throwError(() => ({})));
    component.inviteEmail.setValue('other@acme.com');
    component.inviteMember();
    expect(snackMock.open).toHaveBeenCalledWith('Failed to invite member.', 'Dismiss', expect.any(Object));
  });

  it('should remove a member', () => {
    orgService.removeMember.mockReturnValue(of(undefined as any));
    component.removeMember(mockMembers[1]);
    expect(orgService.removeMember).toHaveBeenCalledWith('org-1', 'mem-2');
    expect(component.members().find(m => m.id === 'mem-2')).toBeUndefined();
  });

  it('should show snackbar on removeMember error', () => {
    orgService.removeMember.mockReturnValue(throwError(() => new Error('fail')));
    component.removeMember(mockMembers[0]);
    expect(snackMock.open).toHaveBeenCalledWith('Failed to remove.', 'Dismiss', expect.any(Object));
  });

  describe('roleColor()', () => {
    it('returns warn for OWNER', () => expect(component.roleColor('OWNER')).toBe('warn'));
    it('returns accent for ADMIN', () => expect(component.roleColor('ADMIN')).toBe('accent'));
    it('returns primary for MEMBER', () => expect(component.roleColor('MEMBER')).toBe('primary'));
  });

  it('currentUserId returns empty string when currentUser returns null', () => {
    (component as any).authService = { currentUser: () => null };
    expect(component.currentUserId()).toBe('');
  });

  it('onTabChange(1) triggers webhook loading', () => {
    const whService = TestBed.inject(WebhookService) as jest.Mocked<WebhookService>;
    component.onTabChange(1);
    expect(whService.list).toHaveBeenCalledWith('org-1');
  });

  it('onTabChange(2) triggers api key loading', () => {
    const akService = TestBed.inject(ApiKeyService) as jest.Mocked<ApiKeyService>;
    component.onTabChange(2);
    expect(akService.list).toHaveBeenCalledWith('org-1');
  });

  it('saveRetention shows snackbar with days', () => {
    component.retentionDays.setValue(365);
    component.saveRetention();
    expect(snackMock.open).toHaveBeenCalledWith('Retention set to 365 days.', 'OK', expect.any(Object));
  });

  it('saveRetention does nothing when invalid', () => {
    component.retentionDays.setValue(0);
    component.saveRetention();
    expect(snackMock.open).not.toHaveBeenCalled();
  });

  // ── Coverage: lines 346-374 (webhook CRUD) ──

  describe('webhook CRUD', () => {
    let whService: jest.Mocked<WebhookService>;

    beforeEach(() => {
      whService = TestBed.inject(WebhookService) as jest.Mocked<WebhookService>;
    });

    it('createWebhook adds webhook to list and shows secret', () => {
      const created = { id: 'wh-1', url: 'https://example.com/hook', events: ['matter.created'], isActive: true, secret: 'sec-123' };
      whService.create.mockReturnValue(of(created as any));

      component.webhookForm.setValue({ url: 'https://example.com/hook', events: ['matter.created'] });
      component.createWebhook();

      expect(whService.create).toHaveBeenCalledWith('org-1', { url: 'https://example.com/hook', events: ['matter.created'] });
      expect(component.webhooks()).toContainEqual(created);
      expect(component.newWebhookSecret()).toBe('sec-123');
      expect(snackMock.open).toHaveBeenCalledWith('Webhook created.', 'OK', expect.any(Object));
    });

    it('createWebhook does nothing when form is invalid', () => {
      component.webhookForm.setValue({ url: '', events: [] });
      component.createWebhook();
      expect(whService.create).not.toHaveBeenCalled();
    });

    it('createWebhook shows error snackbar on failure', () => {
      whService.create.mockReturnValue(throwError(() => ({ error: { error: 'Bad URL' } })));
      component.webhookForm.setValue({ url: 'https://bad.com', events: ['matter.created'] });
      component.createWebhook();
      expect(snackMock.open).toHaveBeenCalledWith('Bad URL', 'Dismiss', expect.any(Object));
    });

    it('createWebhook shows fallback error when no server message', () => {
      whService.create.mockReturnValue(throwError(() => ({})));
      component.webhookForm.setValue({ url: 'https://bad.com', events: ['matter.created'] });
      component.createWebhook();
      expect(snackMock.open).toHaveBeenCalledWith('Failed.', 'Dismiss', expect.any(Object));
    });

    it('toggleWebhook updates the webhook in the list', () => {
      const wh = { id: 'wh-1', url: 'https://example.com', events: ['matter.created'], isActive: true };
      component.webhooks.set([wh as any]);
      const updated = { ...wh, isActive: false };
      whService.update.mockReturnValue(of(updated as any));

      component.toggleWebhook(wh as any);

      expect(whService.update).toHaveBeenCalledWith('org-1', 'wh-1', { isActive: false });
      expect(component.webhooks()[0].isActive).toBe(false);
    });

    it('toggleWebhook shows error snackbar on failure', () => {
      const wh = { id: 'wh-1', url: 'https://example.com', events: ['matter.created'], isActive: true };
      component.webhooks.set([wh as any]);
      whService.update.mockReturnValue(throwError(() => new Error('fail')));

      component.toggleWebhook(wh as any);
      expect(snackMock.open).toHaveBeenCalledWith('Failed to toggle.', 'Dismiss', expect.any(Object));
    });

    it('deleteWebhook removes webhook from the list', () => {
      const wh = { id: 'wh-1', url: 'https://example.com', events: ['matter.created'], isActive: true };
      component.webhooks.set([wh as any]);
      whService.remove.mockReturnValue(of(undefined as any));

      component.deleteWebhook(wh as any);

      expect(whService.remove).toHaveBeenCalledWith('org-1', 'wh-1');
      expect(component.webhooks()).toHaveLength(0);
      expect(snackMock.open).toHaveBeenCalledWith('Deleted.', 'OK', expect.any(Object));
    });

    it('deleteWebhook shows error snackbar on failure', () => {
      const wh = { id: 'wh-1', url: 'https://example.com', events: ['matter.created'], isActive: true };
      component.webhooks.set([wh as any]);
      whService.remove.mockReturnValue(throwError(() => new Error('fail')));

      component.deleteWebhook(wh as any);
      expect(snackMock.open).toHaveBeenCalledWith('Failed.', 'Dismiss', expect.any(Object));
    });

    it('loadWebhooks sets webhooks on success', () => {
      const data = [{ id: 'wh-1', url: 'https://x.com', events: ['matter.created'], isActive: true }];
      whService.list.mockReturnValue(of({ data } as any));

      component.loadWebhooks();

      expect(component.webhooksLoading()).toBe(false);
      expect(component.webhooks()).toEqual(data);
    });

    it('loadWebhooks resets loading on error', () => {
      whService.list.mockReturnValue(throwError(() => new Error('fail')));

      component.loadWebhooks();

      expect(component.webhooksLoading()).toBe(false);
    });
  });

  // ── Coverage: lines 382-402 (API key management) ──

  describe('API key management', () => {
    let akService: jest.Mocked<ApiKeyService>;

    beforeEach(() => {
      akService = TestBed.inject(ApiKeyService) as jest.Mocked<ApiKeyService>;
    });

    it('createApiKey adds key to list and shows rawKey', () => {
      const created = { id: 'ak-1', name: 'CI Key', prefix: 'cc_', rawKey: 'cc_abc123', lastUsedAt: null };
      akService.create.mockReturnValue(of(created as any));
      component.apiKeyName.setValue('CI Key');

      component.createApiKey();

      expect(akService.create).toHaveBeenCalledWith('org-1', 'CI Key');
      expect(component.apiKeys()).toContainEqual(created);
      expect(component.newRawKey()).toBe('cc_abc123');
      expect(snackMock.open).toHaveBeenCalledWith('API key created.', 'OK', expect.any(Object));
    });

    it('createApiKey does nothing when apiKeyName is invalid', () => {
      component.apiKeyName.setValue('');
      component.createApiKey();
      expect(akService.create).not.toHaveBeenCalled();
    });

    it('createApiKey shows error snackbar on failure', () => {
      akService.create.mockReturnValue(throwError(() => ({ error: { error: 'Limit reached' } })));
      component.apiKeyName.setValue('Key');
      component.createApiKey();
      expect(snackMock.open).toHaveBeenCalledWith('Limit reached', 'Dismiss', expect.any(Object));
    });

    it('createApiKey shows fallback error when no server message', () => {
      akService.create.mockReturnValue(throwError(() => ({})));
      component.apiKeyName.setValue('Key');
      component.createApiKey();
      expect(snackMock.open).toHaveBeenCalledWith('Failed.', 'Dismiss', expect.any(Object));
    });

    it('revokeApiKey removes key from the list', () => {
      const key = { id: 'ak-1', name: 'CI Key', prefix: 'cc_', lastUsedAt: null };
      component.apiKeys.set([key as any]);
      akService.revoke.mockReturnValue(of(undefined as any));

      component.revokeApiKey(key as any);

      expect(akService.revoke).toHaveBeenCalledWith('org-1', 'ak-1');
      expect(component.apiKeys()).toHaveLength(0);
      expect(snackMock.open).toHaveBeenCalledWith('Revoked.', 'OK', expect.any(Object));
    });

    it('revokeApiKey shows error snackbar on failure', () => {
      const key = { id: 'ak-1', name: 'CI Key', prefix: 'cc_', lastUsedAt: null };
      component.apiKeys.set([key as any]);
      akService.revoke.mockReturnValue(throwError(() => new Error('fail')));

      component.revokeApiKey(key as any);
      expect(snackMock.open).toHaveBeenCalledWith('Failed.', 'Dismiss', expect.any(Object));
    });

    it('loadApiKeys sets apiKeys on success', () => {
      const data = [{ id: 'ak-1', name: 'CI', prefix: 'cc_', lastUsedAt: null }];
      akService.list.mockReturnValue(of({ data } as any));

      component.loadApiKeys();

      expect(component.apiKeysLoading()).toBe(false);
      expect(component.apiKeys()).toEqual(data);
    });

    it('loadApiKeys resets loading on error', () => {
      akService.list.mockReturnValue(throwError(() => new Error('fail')));

      component.loadApiKeys();

      expect(component.apiKeysLoading()).toBe(false);
    });
  });
});
