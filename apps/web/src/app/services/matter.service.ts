import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface Matter {
  id:           string;
  title:        string;
  description?: string | null;
  status:       'OPEN' | 'ON_HOLD' | 'CLOSED';
  ownerId?:     string;
  createdAt?:   string;
  owner?:       { id: string; firstName: string; lastName: string; email: string };
  _count?:      { contracts: number; documents: number; tasks: number };
}

export interface MatterPage { data: Matter[]; total: number; limit: number; offset: number; }

@Injectable({ providedIn: 'root' })
export class MatterService {
  private http   = inject(HttpClient);
  private apiUrl = '/api/matters';

  getMatters(params?: { status?: string; limit?: number; offset?: number }): Observable<MatterPage> {
    let p = new HttpParams();
    if (params?.status) p = p.set('status', params.status);
    if (params?.limit  !== undefined) p = p.set('limit',  String(params.limit));
    if (params?.offset !== undefined) p = p.set('offset', String(params.offset));
    return this.http.get<MatterPage>(this.apiUrl, { params: p });
  }

  getMatter(id: string): Observable<Matter> {
    return this.http.get<Matter>(`${this.apiUrl}/${id}`);
  }

  createMatter(payload: { title: string; description?: string; status?: string }): Observable<Matter> {
    return this.http.post<Matter>(this.apiUrl, payload);
  }

  updateMatter(id: string, payload: Partial<{ title: string; description: string; status: string }>): Observable<Matter> {
    return this.http.patch<Matter>(`${this.apiUrl}/${id}`, payload);
  }

  deleteMatter(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
