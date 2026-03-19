import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrganizationSettingsComponent } from './organization-settings.component';
import { OrganizationService } from '../../services/organization.service';
import { AuthService } from '../../services/auth.service';
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

  beforeEach(async () => {
    const orgServiceMock = {
      getMyOrganizations: jest.fn().mockReturnValue(of(mockOrgs)),
      getMembers:         jest.fn().mockReturnValue(of(mockMembers)),
      addMember:          jest.fn(),
      removeMember:       jest.fn(),
      updateMember:       jest.fn(),
    };
    const authServiceMock = { currentUser: () => ({ id: 'user-1' }) };
    const snackMock = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [OrganizationSettingsComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimations(),
        { provide: OrganizationService, useValue: orgServiceMock },
        { provide: AuthService,         useValue: authServiceMock },
        { provide: MatSnackBar,         useValue: snackMock },
      ],
    }).compileComponents();

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

  it('should invite a member', () => {
    const newMember = { ...mockMembers[1], id: 'mem-3', userId: 'user-3' };
    orgService.addMember.mockReturnValue(of(newMember));
    component.inviteEmail.setValue('new@acme.com');
    component.inviteRole.setValue('MEMBER');
    component.inviteMember();
    expect(orgService.addMember).toHaveBeenCalledWith('org-1', { email: 'new@acme.com', role: 'MEMBER' });
  });

  it('should remove a member', () => {
    orgService.removeMember.mockReturnValue(of(undefined as any));
    component.removeMember(mockMembers[1]);
    expect(orgService.removeMember).toHaveBeenCalledWith('org-1', 'mem-2');
    expect(component.members().find(m => m.id === 'mem-2')).toBeUndefined();
  });
});
