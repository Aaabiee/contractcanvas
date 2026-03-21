import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { switchMap, filter } from 'rxjs';
import { SearchService, SearchResults } from '../../services/search.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatChipsModule,
  ],
  template: `
    <div class="search-page">
      <h2 class="page-title">
        Search results
        <span *ngIf="query()" class="query-label">for "{{ query() }}"</span>
      </h2>

      <ng-container *ngIf="loading()">
        <mat-spinner diameter="40" style="margin:40px auto"></mat-spinner>
      </ng-container>

      <ng-container *ngIf="!loading() && results() as r">
        <p *ngIf="r.total === 0" class="no-results">
          No results found for "{{ r.q }}". Try a different search term.
        </p>

        <ng-container *ngIf="r.matters.length > 0">
          <h3 class="section-title"><mat-icon>work</mat-icon> Matters ({{ r.matters.length }})</h3>
          <mat-card class="results-card">
            <mat-list>
              <ng-container *ngFor="let m of r.matters; let last = last">
                <mat-list-item [routerLink]="['/matters', m.id]" class="result-item">
                  <mat-icon matListItemIcon>work</mat-icon>
                  <span matListItemTitle>{{ m.title }}</span>
                  <span matListItemLine *ngIf="m.description">{{ m.description }}</span>
                  <mat-chip-set matListItemMeta>
                    <mat-chip [ngClass]="statusClass(m.status)">{{ m.status }}</mat-chip>
                  </mat-chip-set>
                </mat-list-item>
                <mat-divider *ngIf="!last"></mat-divider>
              </ng-container>
            </mat-list>
          </mat-card>
        </ng-container>

        <ng-container *ngIf="r.contracts.length > 0">
          <h3 class="section-title"><mat-icon>description</mat-icon> Contracts ({{ r.contracts.length }})</h3>
          <mat-card class="results-card">
            <mat-list>
              <ng-container *ngFor="let c of r.contracts; let last = last">
                <mat-list-item [routerLink]="['/contracts', c.id]" class="result-item">
                  <mat-icon matListItemIcon>description</mat-icon>
                  <span matListItemTitle>{{ c.title }}</span>
                  <span matListItemLine *ngIf="c.description">{{ c.description }}</span>
                  <mat-chip-set matListItemMeta>
                    <mat-chip [ngClass]="statusClass(c.status)">{{ c.status }}</mat-chip>
                  </mat-chip-set>
                </mat-list-item>
                <mat-divider *ngIf="!last"></mat-divider>
              </ng-container>
            </mat-list>
          </mat-card>
        </ng-container>

        <ng-container *ngIf="r.documents.length > 0">
          <h3 class="section-title"><mat-icon>cloud_upload</mat-icon> Documents ({{ r.documents.length }})</h3>
          <mat-card class="results-card">
            <mat-list>
              <ng-container *ngFor="let d of r.documents; let last = last">
                <mat-list-item class="result-item">
                  <mat-icon matListItemIcon>insert_drive_file</mat-icon>
                  <span matListItemTitle>{{ d.filename }}</span>
                  <span matListItemLine>{{ d.mimeType }}</span>
                </mat-list-item>
                <mat-divider *ngIf="!last"></mat-divider>
              </ng-container>
            </mat-list>
          </mat-card>
        </ng-container>
      </ng-container>
    </div>
  `,
  styles: [`
    .search-page { padding: 24px; max-width: 860px; margin: 0 auto; }
    .page-title  { font-size: 22px; font-weight: 500; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }
    .query-label { color: #555; font-weight: 400; }
    .no-results  { color: #888; font-style: italic; margin: 32px 0; text-align: center; }
    .section-title { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 500; margin: 20px 0 8px; }
    .section-title mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .results-card { margin-bottom: 16px; }
    .result-item { cursor: pointer; }
    .result-item:hover { background: #f5f5f5; }
    .status-open   { background: #e8f5e9 !important; color: #2e7d32 !important; }
    .status-closed { background: #f3e5f5 !important; color: #6a1b9a !important; }
    .status-on-hold { background: #fff3e0 !important; color: #e65100 !important; }
  `],
})
export class SearchComponent implements OnInit {
  private route         = inject(ActivatedRoute);
  private searchService = inject(SearchService);

  query   = signal('');
  loading = signal(false);
  results = signal<SearchResults | null>(null);

  ngOnInit(): void {
    this.route.queryParams.pipe(
      filter(p => !!p['q']),
      switchMap(p => {
        this.query.set(p['q']);
        this.loading.set(true);
        this.results.set(null);
        return this.searchService.search(p['q']);
      }),
    ).subscribe({
      next:  r  => { this.results.set(r);    this.loading.set(false); },
      error: () => {                          this.loading.set(false); },
    });
  }

  statusClass(status: string): string {
    return 'status-' + status.toLowerCase().replace(/_/g, '-');
  }
}
