import { Injectable, inject, signal, NgZone } from '@angular/core';
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
  private http   = inject(HttpClient);
  private zone   = inject(NgZone);
  private base   = '/api/notifications';

  unreadCount = signal(0);

  private eventSource: EventSource | null = null;
  onNotification?: (n: Notification) => void;

  startStream(): void {
    if (this.eventSource) return;
    this.eventSource = new EventSource('/api/events/stream', { withCredentials: true });
    this.eventSource.addEventListener('notification', (e: MessageEvent) => {
      this.zone.run(() => {
        this.unreadCount.update(n => n + 1);
        try {
          const notification = JSON.parse(e.data) as Notification;
          this.onNotification?.(notification);
        } catch { /* ignore malformed */ }
      });
    });
    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = null;
      setTimeout(() => this.startStream(), 5_000);
    };
  }

  stopStream(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

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
