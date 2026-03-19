import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface Notification {
  id:             string;
  userId:         string;
  organizationId: string;
  type:           'SYSTEM' | 'MENTION' | 'REMINDER' | 'BILLING';
  title:          string;
  body:           string | null;
  data:           Record<string, unknown> | null;
  readAt:         string | null;
  createdAt:      string;
}

export interface NotificationPage {
  data:        Notification[];
  total:       number;
  unreadCount: number;
  limit:       number;
  offset:      number;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);
  private base = '/api/notifications';

  unreadCount = signal(0);

  getNotifications(params?: { unread?: boolean; limit?: number; offset?: number }): Observable<NotificationPage> {
    let p = new HttpParams();
    if (params?.unread  !== undefined) p = p.set('unread', String(params.unread));
    if (params?.limit   !== undefined) p = p.set('limit',  String(params.limit));
    if (params?.offset  !== undefined) p = p.set('offset', String(params.offset));
    return this.http.get<NotificationPage>(this.base, { params: p }).pipe(
      tap(page => this.unreadCount.set(page.unreadCount))
    );
  }

  markRead(id: string): Observable<Notification> {
    return this.http.patch<Notification>(`${this.base}/${id}/read`, {}).pipe(
      tap(() => this.unreadCount.update(n => Math.max(0, n - 1)))
    );
  }

  markAllRead(): Observable<{ ok: boolean; updated: number }> {
    return this.http.patch<{ ok: boolean; updated: number }>(`${this.base}/read-all`, {}).pipe(
      tap(() => this.unreadCount.set(0))
    );
  }
}
