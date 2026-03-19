import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Task {
  id:             string;
  title:          string;
  description:    string | null;
  matterId:       string;
  organizationId: string;
  assigneeId:     string | null;
  dueAt:          string | null;
  completedAt:    string | null;
  createdAt:      string;
  assignee?: { id: string; firstName: string; lastName: string; email: string } | null;
  matter?:   { id: string; title: string };
}

export interface TaskPage { data: Task[]; total: number; limit: number; offset: number; }

export interface CreateTaskPayload {
  title:       string;
  description?: string;
  matterId:    string;
  assigneeId?: string;
  dueAt?:      string;
}

export interface UpdateTaskPayload {
  title?:       string;
  description?: string | null;
  assigneeId?:  string | null;
  dueAt?:       string | null;
  completedAt?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private http = inject(HttpClient);
  private base = '/api/tasks';

  getTasks(params?: { matterId?: string; assigneeId?: string; completed?: boolean; limit?: number; offset?: number }): Observable<TaskPage> {
    let p = new HttpParams();
    if (params?.matterId)   p = p.set('matterId',   params.matterId);
    if (params?.assigneeId) p = p.set('assigneeId', params.assigneeId);
    if (params?.completed !== undefined) p = p.set('completed', String(params.completed));
    if (params?.limit  !== undefined) p = p.set('limit',  String(params.limit));
    if (params?.offset !== undefined) p = p.set('offset', String(params.offset));
    return this.http.get<TaskPage>(this.base, { params: p });
  }

  getTask(id: string): Observable<Task> {
    return this.http.get<Task>(`${this.base}/${id}`);
  }

  createTask(payload: CreateTaskPayload): Observable<Task> {
    return this.http.post<Task>(this.base, payload);
  }

  updateTask(id: string, payload: UpdateTaskPayload): Observable<Task> {
    return this.http.patch<Task>(`${this.base}/${id}`, payload);
  }

  completeTask(id: string): Observable<Task> {
    return this.http.patch<Task>(`${this.base}/${id}`, { completedAt: new Date().toISOString() });
  }

  reopenTask(id: string): Observable<Task> {
    return this.http.patch<Task>(`${this.base}/${id}`, { completedAt: null });
  }

  deleteTask(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
