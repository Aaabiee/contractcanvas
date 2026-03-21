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
});
