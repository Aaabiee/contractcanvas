import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CreateInvoicePayload {
  contractId:  string;
  amountCents: number;
  currency?:   string;
  dueAt?:      string;
}

export interface InvoiceIntent {
  clientSecret: string;
  invoiceId:    string;
  amountCents:  number;
  currency:     string;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);
  private base = '/api/billing';

  createInvoice(payload: CreateInvoicePayload): Observable<InvoiceIntent> {
    return this.http.post<InvoiceIntent>(`${this.base}/invoice`, payload);
  }
}
