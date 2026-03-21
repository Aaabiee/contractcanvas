import 'zone.js/testing';
/**
 * Component integration tests for AdminComponent.
 *
 * Uses REAL OrganizationService + MatterService + ContractService
 * with HttpTestingController to verify the full component → service → HTTP chain.
 */

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { AdminComponent } from './admin.component';
import { OrganizationService } from '../../services/organization.service';
import { MatterService }        from '../../services/matter.service';
import { ContractService }      from '../../services/contract.service';
import { AuthService }          from '../../services/auth.service';
import { AuditLogService }     from '../../services/audit-log.service';

const mockCurrentUser = signal<any>({ id: 'u1', email: 'alice@acme.com', role: 'ADMIN' });

class MockAuthService {
  currentUser = mockCurrentUser;
}

const mockOrgs = [
  { id: 'org1', name: 'ACME Legal', slug: 'acme-legal', createdAt: '2024-01-01T00:00:00Z' }
];

const mockMembers = [
  { id: 'mem1', organizationId: 'org1', userId: 'u1', role: 'OWNER' as const, createdAt: '2024-01-01T00:00:00Z',
    user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@acme.com' } },
  { id: 'mem2', organizationId: 'org1', userId: 'u2', role: 'MEMBER' as const, createdAt: '2024-02-01T00:00:00Z',
    user: { id: 'u2', firstName: 'Bob',   lastName: 'Jones', email: 'bob@acme.com'   } },
];

describe('AdminComponent (integration — real Org/Matter/ContractService)', () => {
  let fixture:   ComponentFixture<AdminComponent>;
  let component: AdminComponent;
  let httpMock:  HttpTestingController;
  let snackBar:  { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [AdminComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        OrganizationService,
        MatterService,
        ContractService,
        { provide: AuthService, useClass: MockAuthService },
        { provide: AuditLogService, useValue: { getLogs: jest.fn().mockReturnValue(of({ data: [], total: 0, limit: 25, offset: 0 })), exportCsv: jest.fn() } },
      ],
    })
      .overrideComponent(AdminComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    httpMock  = TestBed.inject(HttpTestingController);
    fixture   = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => httpMock.verify());

  function flushInit() {
    // 1. GET /api/organizations/me
    httpMock.expectOne('/api/organizations/me').flush(mockOrgs);
    // 2. forkJoin: GET /api/organizations/org1/members + GET /api/matters + GET /api/contracts
    httpMock.expectOne('/api/organizations/org1/members').flush(mockMembers);
    httpMock.expectOne(r => r.url === '/api/matters').flush({ data: [], total: 4, limit: 1, offset: 0 });
    httpMock.expectOne(r => r.url === '/api/contracts').flush({ data: [], total: 7, limit: 1, offset: 0 });
    tick();
  }

  it('sends GET /api/organizations/me on init then parallel forkJoin for stats', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();
    fixture.detectChanges();

    expect(component.orgName()).toBe('ACME Legal');
    expect(component.members()).toHaveLength(2);
    expect(component.openMatters()).toBe(4);
    expect(component.totalContracts()).toBe(7);
    expect(component.loading()).toBe(false);
  }));

  it('currentUserId is derived from AuthService.currentUser signal', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();

    expect(component.currentUserId()).toBe('u1');
  }));

  it('handles empty org list gracefully — loading stops, members empty', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/organizations/me').flush([]);
    tick();

    expect(component.loading()).toBe(false);
    expect(component.members()).toHaveLength(0);
  }));

  it('inviteMember sends POST /api/organizations/org1/members and adds member to list', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();

    const newMember = {
      id: 'mem3', organizationId: 'org1', userId: 'u3', role: 'MEMBER',
      createdAt: '2024-03-01T00:00:00Z',
      user: { id: 'u3', firstName: 'Carol', lastName: 'White', email: 'carol@acme.com' },
    };

    component.inviteForm.setValue({ email: 'carol@acme.com', role: 'MEMBER' });
    component.inviteMember();

    const req = httpMock.expectOne(r =>
      r.url === '/api/organizations/org1/members' && r.method === 'POST'
    );
    expect(req.request.body).toEqual({ email: 'carol@acme.com', role: 'MEMBER' });
    req.flush(newMember);
    tick();

    expect(component.members()).toHaveLength(3);
    expect(snackBar.open).toHaveBeenCalledWith('Member invited successfully.', 'OK', expect.any(Object));
    expect(component.inviteForm.get('email')!.value).toBe('');
  }));

  it('inviteMember does nothing when form is invalid', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();

    component.inviteForm.get('email')!.setValue('not-an-email');
    component.inviteMember();

    httpMock.expectNone(r => r.url === '/api/organizations/org1/members' && r.method === 'POST');
  }));

  it('inviteMember shows error snackbar on HTTP failure', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();

    component.inviteForm.setValue({ email: 'fail@acme.com', role: 'MEMBER' });
    component.inviteMember();

    httpMock
      .expectOne(r => r.url === '/api/organizations/org1/members' && r.method === 'POST')
      .flush({ error: { message: 'Email already member' } }, { status: 409, statusText: 'Conflict' });
    tick();

    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringMatching(/member|email/i), 'Dismiss', expect.any(Object)
    );
  }));

  it('removeMember sends DELETE and removes member from list after confirm', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });

    component.removeMember(mockMembers[1]);
    tick();

    const req = httpMock.expectOne(r =>
      r.url === '/api/organizations/org1/members/mem2' && r.method === 'DELETE'
    );
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(component.members().find(m => m.id === 'mem2')).toBeUndefined();
  }));

  it('removeMember shows error snackbar on HTTP failure', fakeAsync(() => {
    fixture.detectChanges();
    flushInit();
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });

    component.removeMember(mockMembers[1]);
    tick();

    httpMock
      .expectOne(r => r.url === '/api/organizations/org1/members/mem2' && r.method === 'DELETE')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    expect(snackBar.open).toHaveBeenCalledWith('Failed to remove member.', 'Dismiss', expect.any(Object));
  }));
});
