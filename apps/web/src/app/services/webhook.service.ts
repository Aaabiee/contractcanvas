import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface OutboundWebhook {
  id:        string;
  url:       string;
  events:    string[];
  isActive:  boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface WebhookDelivery {
  id:         string;
  event:      string;
  statusCode: number;
  success:    boolean;
  attempts:   number;
  createdAt:  string;
}

@Injectable({ providedIn: 'root' })
export class WebhookService {
  private http = inject(HttpClient);

  list(orgId: string): Observable<{ data: OutboundWebhook[] }> {
    return this.http.get<{ data: OutboundWebhook[] }>(`/api/organizations/${orgId}/webhooks`);
  }

  create(orgId: string, data: { url: string; events: string[] }): Observable<OutboundWebhook & { secret: string }> {
    return this.http.post<OutboundWebhook & { secret: string }>(`/api/organizations/${orgId}/webhooks`, data);
  }

  update(orgId: string, webhookId: string, data: Partial<{ url: string; events: string[]; isActive: boolean }>): Observable<OutboundWebhook> {
    return this.http.patch<OutboundWebhook>(`/api/organizations/${orgId}/webhooks/${webhookId}`, data);
  }

  remove(orgId: string, webhookId: string): Observable<void> {
    return this.http.delete<void>(`/api/organizations/${orgId}/webhooks/${webhookId}`);
  }

  deliveries(orgId: string, webhookId: string): Observable<{ data: WebhookDelivery[] }> {
    return this.http.get<{ data: WebhookDelivery[] }>(`/api/organizations/${orgId}/webhooks/${webhookId}/deliveries`);
  }
}
