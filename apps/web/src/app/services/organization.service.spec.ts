import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { OrganizationService, Organization, OrgMember } from './organization.service';

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date().toISOString(), ...overrides };
}

function makeMember(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    id: 'm1', organizationId: 'org-1', userId: 'u1', role: 'MEMBER',
    createdAt: new Date().toISOString(),
    user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
    ...overrides,
  };
}

describe('OrganizationService', () => {
  let service: OrganizationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrganizationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('getMyOrganizations()', () => {
    it('GETs /api/organizations/me', () => {
      service.getMyOrganizations().subscribe();
      const req = http.expectOne('/api/organizations/me');
      expect(req.request.method).toBe('GET');
      req.flush([makeOrg()]);
    });

    it('returns list of organizations', () => {
      const orgs = [makeOrg(), makeOrg({ id: 'org-2', slug: 'beta' })];
      let result: Organization[] | undefined;
      service.getMyOrganizations().subscribe(o => (result = o));
      http.expectOne('/api/organizations/me').flush(orgs);
      expect(result).toHaveLength(2);
      expect(result![0].id).toBe('org-1');
    });
  });

  describe('getMembers()', () => {
    it('GETs /api/organizations/:orgId/members', () => {
      service.getMembers('org-1').subscribe();
      const req = http.expectOne('/api/organizations/org-1/members');
      expect(req.request.method).toBe('GET');
      req.flush([makeMember()]);
    });

    it('returns list of members', () => {
      let result: OrgMember[] | undefined;
      service.getMembers('org-1').subscribe(m => (result = m));
      http.expectOne('/api/organizations/org-1/members').flush([makeMember(), makeMember({ id: 'm2' })]);
      expect(result).toHaveLength(2);
    });
  });

  describe('addMember()', () => {
    it('POSTs to /api/organizations/:orgId/members with payload', () => {
      const payload = { email: 'bob@example.com', role: 'MEMBER' };
      service.addMember('org-1', payload).subscribe();
      const req = http.expectOne('/api/organizations/org-1/members');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(makeMember());
    });

    it('returns the created member', () => {
      let result: OrgMember | undefined;
      service.addMember('org-1', { email: 'bob@example.com', role: 'MEMBER' }).subscribe(m => (result = m));
      http.expectOne('/api/organizations/org-1/members').flush(makeMember({ id: 'm-new' }));
      expect(result!.id).toBe('m-new');
    });
  });

  describe('updateMember()', () => {
    it('PATCHes /api/organizations/:orgId/members/:memberId with payload', () => {
      const payload = { role: 'ADMIN' };
      service.updateMember('org-1', 'm1', payload).subscribe();
      const req = http.expectOne('/api/organizations/org-1/members/m1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(payload);
      req.flush(makeMember({ role: 'ADMIN' }));
    });

    it('returns the updated member', () => {
      let result: OrgMember | undefined;
      service.updateMember('org-1', 'm1', { role: 'ADMIN' }).subscribe(m => (result = m));
      http.expectOne('/api/organizations/org-1/members/m1').flush(makeMember({ role: 'ADMIN' }));
      expect(result!.role).toBe('ADMIN');
    });
  });

  describe('removeMember()', () => {
    it('DELETEs /api/organizations/:orgId/members/:memberId', () => {
      service.removeMember('org-1', 'm1').subscribe();
      const req = http.expectOne('/api/organizations/org-1/members/m1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('completes without error on success', () => {
      let completed = false;
      service.removeMember('org-1', 'm1').subscribe({ complete: () => (completed = true) });
      http.expectOne('/api/organizations/org-1/members/m1').flush(null);
      expect(completed).toBe(true);
    });
  });
});
