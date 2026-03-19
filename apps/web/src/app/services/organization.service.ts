import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Organization {
  id:        string;
  name:      string;
  slug:      string;
  createdAt: string;
}

export interface OrgMember {
  id:             string;
  organizationId: string;
  userId:         string;
  role:           'OWNER' | 'ADMIN' | 'MEMBER';
  createdAt:      string;
  user: {
    id:        string;
    firstName: string;
    lastName:  string;
    email:     string;
  };
}

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private http = inject(HttpClient);
  private base = '/api/organizations';

  getMyOrganizations(): Observable<Organization[]> {
    return this.http.get<Organization[]>(`${this.base}/me`);
  }

  getMembers(orgId: string): Observable<OrgMember[]> {
    return this.http.get<OrgMember[]>(`${this.base}/${orgId}/members`);
  }

  addMember(orgId: string, payload: { email: string; role: string }): Observable<OrgMember> {
    return this.http.post<OrgMember>(`${this.base}/${orgId}/members`, payload);
  }

  updateMember(orgId: string, memberId: string, payload: { role: string }): Observable<OrgMember> {
    return this.http.patch<OrgMember>(`${this.base}/${orgId}/members/${memberId}`, payload);
  }

  removeMember(orgId: string, memberId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${orgId}/members/${memberId}`);
  }
}
