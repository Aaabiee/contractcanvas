import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Matter {
  id: string;
  title: string;
  description?: string | null;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
}

@Injectable({
  providedIn: 'root'
})
export class MatterService {
  private http = inject(HttpClient);
  private apiUrl = '/api/matters';

  getMatters(): Observable<Matter[]> {
    return this.http.get<Matter[]>(this.apiUrl);
  }

  getMatter(id: string): Observable<Matter> {
    return this.http.get<Matter>(`${this.apiUrl}/${id}`);
  }
}
