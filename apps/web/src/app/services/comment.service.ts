import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CommentAuthor {
  id:        string;
  firstName: string;
  lastName:  string;
  email:     string;
}

export interface Comment {
  id:                string;
  bodyMd:            string;
  authorId:          string;
  author:            CommentAuthor;
  matterId?:         string | null;
  contractId?:       string | null;
  contractVersionId?: string | null;
  documentId?:       string | null;
  createdAt:         string;
  editedAt?:         string | null;
}

export interface CommentPage {
  data:   Comment[];
  total:  number;
  limit:  number;
  offset: number;
}

export interface CreateCommentPayload {
  bodyMd:            string;
  matterId?:         string;
  contractId?:       string;
  contractVersionId?: string;
  documentId?:       string;
}

@Injectable({ providedIn: 'root' })
export class CommentService {
  private http   = inject(HttpClient);
  private apiUrl = '/api/comments';

  getComments(params: {
    matterId?:         string;
    contractId?:       string;
    documentId?:       string;
    contractVersionId?: string;
    limit?:            number;
    offset?:           number;
  }): Observable<CommentPage> {
    let p = new HttpParams();
    if (params.matterId)          p = p.set('matterId',          params.matterId);
    if (params.contractId)        p = p.set('contractId',        params.contractId);
    if (params.documentId)        p = p.set('documentId',        params.documentId);
    if (params.contractVersionId) p = p.set('contractVersionId', params.contractVersionId);
    if (params.limit  !== undefined) p = p.set('limit',  String(params.limit));
    if (params.offset !== undefined) p = p.set('offset', String(params.offset));
    return this.http.get<CommentPage>(this.apiUrl, { params: p });
  }

  createComment(payload: CreateCommentPayload): Observable<Comment> {
    return this.http.post<Comment>(this.apiUrl, payload);
  }

  updateComment(id: string, bodyMd: string): Observable<Comment> {
    return this.http.patch<Comment>(`${this.apiUrl}/${id}`, { bodyMd });
  }

  deleteComment(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
