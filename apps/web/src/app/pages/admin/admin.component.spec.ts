import 'zone.js/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminComponent } from './admin.component';
import { OrganizationService, OrgMember } from '../../services/organization.service';
import { MatterService } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { AuthService } from '../../services/auth.service';
import { AuditLogService } from '../../services/audit-log.service';

const mockOrgs = [{ id: 'org1', name: 'ACME Legal', slug: 'acme-legal', createdAt: '2024-01-01T00:00:00Z' }];

const mockMembers: OrgMember[] = [
  { id: 'mem1', organizationId: 'org1', userId: 'u1', role: 'OWNER', createdAt: '2024-01-01T00:00:00Z',
    user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@acme.com' } },
  { id: 'mem2', organizationId: 'org1', userId: 'u2', role: 'MEMBER', createdAt: '2024-02-01T00:00:00Z',
    user: { id: 'u2', firstName: 'Bob',   lastName: 'Jones', email: 'bob@acme.com'   } },
];

const mockCurrentUser = signal<any>({ id: 'u1', email: 'alice@acme.com', role: 'ADMIN' });

class MockOrgService {
  getMyOrganizations = jest.fn(() => of(mockOrgs));
  getMembers         = jest.fn(() => of(mockMembers));
  addMember          = jest.fn(() => of(mockMembers[1]));
  removeMember       = jest.fn(() => of(undefined));
}

class MockMatterService {
  getMatters = jest.fn(() => of({ data: [], total: 4, limit: 1, offset: 0 }));
}

class MockContractService {
  getContracts = jest.fn(() => of({ data: [], total: 7, limit: 1, offset: 0 }));
}

class MockAuthService {
  currentUser = mockCurrentUser;
}

class MockAuditLogService {
  getLogs   = jest.fn(() => of({ data: [], total: 0, limit: 25, offset: 0 }));
  exportCsv = jest.fn(() => of(new Blob([''])));
}

describe('AdminComponent', () => {
  let component: AdminComponent;
  let fixture: ComponentFixture<AdminComponent>;
  let orgService: MockOrgService;
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [AdminComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: OrganizationService, useClass: MockOrgService      },
        { provide: MatterService,       useClass: MockMatterService   },
        { provide: ContractService,     useClass: MockContractService },
        { provide: AuthService,         useClass: MockAuthService     },
        { provide: AuditLogService,    useClass: MockAuditLogService },
      ],
    })
      .overrideComponent(AdminComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    fixture    = TestBed.createComponent(AdminComponent);
    component  = fixture.componentInstance;
    orgService = TestBed.inject(OrganizationService) as unknown as MockOrgService;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads org data on init', () => {
    expect(orgService.getMyOrganizations).toHaveBeenCalled();
    expect(orgService.getMembers).toHaveBeenCalledWith('org1');
    expect(component.orgName()).toBe('ACME Legal');
    expect(component.members()).toHaveLength(2);
    expect(component.openMatters()).toBe(4);
    expect(component.totalContracts()).toBe(7);
    expect(component.loading()).toBe(false);
  });

  it('currentUserId returns id from authService currentUser', () => {
    expect(component.currentUserId()).toBe('u1');
  });

  it('inviteMember does nothing when form is invalid', () => {
    component.inviteForm.get('email')!.setValue('not-an-email');
    component.inviteMember();
    expect(orgService.addMember).not.toHaveBeenCalled();
  });

  it('inviteMember calls addMember and shows success snackbar', () => {
    component.inviteForm.setValue({ email: 'new@firm.com', role: 'MEMBER' });
    component.inviteMember();
    expect(orgService.addMember).toHaveBeenCalledWith('org1', { email: 'new@firm.com', role: 'MEMBER' });
    expect(snackBar.open).toHaveBeenCalledWith('Member invited successfully.', 'OK', expect.any(Object));
  });

  it('inviteMember shows error snackbar on failure', () => {
    orgService.addMember.mockReturnValue(throwError(() => ({ error: { message: 'Email already member' } })));
    component.inviteForm.setValue({ email: 'existing@firm.com', role: 'MEMBER' });
    component.inviteMember();
    expect(snackBar.open).toHaveBeenCalledWith('Email already member', 'Dismiss', expect.any(Object));
  });

  it('inviteMember resets form and updates member list on success', () => {
    const initialLen = component.members().length;
    component.inviteForm.setValue({ email: 'new@firm.com', role: 'MEMBER' });
    component.inviteMember();
    expect(component.members()).toHaveLength(initialLen + 1);
    expect(component.inviteForm.get('email')!.value).toBe('');
  });

  it('removeMember removes member after snackbar action', fakeAsync(() => {
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });
    component.removeMember(mockMembers[1]);
    tick();
    expect(orgService.removeMember).toHaveBeenCalledWith('org1', 'mem2');
    expect(component.members().find(m => m.id === 'mem2')).toBeUndefined();
  }));

  it('removeMember shows error when remove fails', fakeAsync(() => {
    orgService.removeMember.mockReturnValue(throwError(() => new Error('fail')));
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });
    component.removeMember(mockMembers[1]);
    tick();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Failed to remove member.', 'Dismiss', expect.any(Object));
  }));

  it('handles empty org list gracefully', () => {
    orgService.getMyOrganizations.mockReturnValue(of([]));
    component.members.set([]);
    component.ngOnInit();
    expect(component.loading()).toBe(false);
    expect(component.members()).toHaveLength(0);
  });
});
