import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SearchMatter {
  id:           string;
  title:        string;
  description?: string | null;
  status:       string;
  createdAt:    string;
}

export interface SearchContract {
  id:        string;
  title:     string;
  status:    string;
  matterId:  string;
  createdAt: string;
}

export interface SearchDocument {
  id:          string;
  filename:    string;
  mimeType:    string;
  matterId?:  string | null;
  versionId?: string | null;
  createdAt:  string;
}

export interface SearchResults {
  q:         string;
  total:     number;
  matters:   SearchMatter[];
  contracts: SearchContract[];
  documents: SearchDocument[];
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  private http = inject(HttpClient);

  search(q: string, limit = 10): Observable<SearchResults> {
    const params = new HttpParams().set('q', q).set('limit', String(limit));
    return this.http.get<SearchResults>('/api/search', { params });
  }
}
