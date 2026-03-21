import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AuditLogEntry {
  id:             string;
  organizationId: string;
  actorId?:       string;
  entity:         string;
  entityId:       string;
  action:         string;
  ip?:            string;
  userAgent?:     string;
  createdAt:      string;
}

export interface AuditLogResponse {
  data:   AuditLogEntry[];
  total:  number;
  limit:  number;
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private http = inject(HttpClient);

  getLogs(orgId: string, opts: { entity?: string; action?: string; limit?: number; offset?: number } = {}): Observable<AuditLogResponse> {
    let params = new HttpParams();
    if (opts.entity) params = params.set('entity', opts.entity);
    if (opts.action) params = params.set('action', opts.action);
    if (opts.limit)  params = params.set('limit', String(opts.limit));
    if (opts.offset) params = params.set('offset', String(opts.offset));
    return this.http.get<AuditLogResponse>(`/api/organizations/${orgId}/audit-logs`, { params });
  }

  exportCsv(orgId: string): Observable<Blob> {
    return this.http.get(`/api/organizations/${orgId}/audit-logs/export.csv`, { responseType: 'blob' });
  }
}
