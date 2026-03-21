import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ApiKey {
  id:          string;
  name:        string;
  prefix:      string;
  lastUsedAt?: string | null;
  createdAt:   string;
  revokedAt?:  string | null;
}

export interface ApiKeyCreateResponse extends ApiKey {
  rawKey: string;
}

@Injectable({ providedIn: 'root' })
export class ApiKeyService {
  private http = inject(HttpClient);

  list(orgId: string): Observable<{ data: ApiKey[] }> {
    return this.http.get<{ data: ApiKey[] }>(`/api/organizations/${orgId}/api-keys`);
  }

  create(orgId: string, name: string): Observable<ApiKeyCreateResponse> {
    return this.http.post<ApiKeyCreateResponse>(`/api/organizations/${orgId}/api-keys`, { name });
  }

  revoke(orgId: string, keyId: string): Observable<void> {
    return this.http.delete<void>(`/api/organizations/${orgId}/api-keys/${keyId}`);
  }
}
