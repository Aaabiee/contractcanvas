import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AnalyticsOverview {
  mattersByStatus:    { status: string; count: number }[];
  contractsByStatus:  { status: string; count: number; totalValueCents: number }[];
  overdueTaskCount:   number;
  storageBytesUsed:   number;
  activeMemberCount:  number;
}

export interface ContractTrendPoint {
  week:         string;
  count:        number;
  totalValueCents: number;
}

export interface ContractTrends {
  period: string;
  data:   ContractTrendPoint[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);

  getOverview(): Observable<AnalyticsOverview> {
    return this.http.get<AnalyticsOverview>('/api/analytics/overview');
  }

  getContractTrends(period: '30d' | '90d' | '1y' = '30d'): Observable<ContractTrends> {
    const params = new HttpParams().set('period', period);
    return this.http.get<ContractTrends>('/api/analytics/contract-trends', { params });
  }
}
