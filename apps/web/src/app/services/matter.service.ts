// apps/web/src/app/services/matter.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Define a basic Matter type (you can expand this)
export interface Matter {
  id: string;
  title: string;
  description?: string | null;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  // Add other fields from your Prisma schema as needed
  // e.g., organizationId: string;
  //       ownerId: string;
}

@Injectable({
  providedIn: 'root'
})
export class MatterService {
  private http = inject(HttpClient);
  private apiUrl = '/api/matters'; // Handled by proxy.conf.json

  /**
   * Fetches all matters for the user's organization.
   */
  getMatters(): Observable<Matter[]> {
    return this.http.get<Matter[]>(this.apiUrl);
  }

  /**
   * Fetches a single matter by its ID.
   * @param id The ID of the matter to fetch.
   */
  getMatter(id: string): Observable<Matter> {
    return this.http.get<Matter>(`${this.apiUrl}/${id}`);
  }
}