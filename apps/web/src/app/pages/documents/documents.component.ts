import {
  Component, ChangeDetectionStrategy, inject, signal, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { catchError, of, switchMap } from 'rxjs';
import { distinctUntilChanged, filter } from 'rxjs/operators';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';

import { DocumentService, Document } from '../../services/document.service';
import { MatterService, Matter } from '../../services/matter.service';

@Component({
  selector: 'app-documents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatSelectModule, MatTableModule, MatChipsModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatTooltipModule, MatDividerModule,
  ],
  template: `
    <div class="page-shell">

      <!-- Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Documents</h1>
          <p class="page-sub">Upload and manage matter documents</p>
        </div>
        <div class="header-actions">
          <input #fileInput type="file" class="hidden-input"
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
            (change)="onFileSelected(fileInput)"
            [disabled]="!matterCtrl.value || uploading()">
          <button mat-raised-button color="primary"
            [disabled]="!matterCtrl.value || uploading()"
            (click)="fileInput.click()">
            <mat-spinner *ngIf="uploading()" diameter="18" class="inline-spinner"></mat-spinner>
            <mat-icon *ngIf="!uploading()">upload_file</mat-icon>
            {{ uploading() ? 'Uploading…' : 'Upload Document' }}
          </button>
        </div>
      </div>

      <!-- Matter Selector -->
      <mat-card class="filter-card">
        <mat-card-content>
          <div class="filter-row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="matter-select">
              <mat-label>Select a matter to view its documents</mat-label>
              <mat-select [formControl]="matterCtrl">
                <mat-option *ngFor="let m of matters()" [value]="m.id">{{ m.title }}</mat-option>
              </mat-select>
              <mat-icon matPrefix>work</mat-icon>
            </mat-form-field>
            <div class="doc-count" *ngIf="matterCtrl.value && !loading()">
              {{ documents().length }} document{{ documents().length !== 1 ? 's' : '' }}
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Loading Matters -->
      <div *ngIf="loadingMatters()" class="center-spinner">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <!-- No matter selected -->
      <div *ngIf="!loadingMatters() && !matterCtrl.value" class="empty-prompt">
        <mat-icon class="empty-icon">folder_open</mat-icon>
        <p>Select a matter above to view its documents</p>
      </div>

      <!-- Loading Documents -->
      <div *ngIf="matterCtrl.value && loading()" class="center-spinner">
        <mat-spinner diameter="36"></mat-spinner>
      </div>

      <!-- Documents Table -->
      <mat-card class="table-card" *ngIf="matterCtrl.value && !loading()">
        <!-- Empty State -->
        <div *ngIf="documents().length === 0" class="empty-state">
          <mat-icon class="empty-icon">upload_file</mat-icon>
          <p>No documents uploaded for this matter yet</p>
          <button mat-stroked-button color="primary" (click)="fileInput.click()">
            <mat-icon>upload</mat-icon> Upload your first document
          </button>
        </div>

        <table mat-table [dataSource]="documents()" *ngIf="documents().length > 0" class="docs-table">

          <ng-container matColumnDef="filename">
            <th mat-header-cell *matHeaderCellDef>File</th>
            <td mat-cell *matCellDef="let doc">
              <div class="file-row">
                <mat-icon class="file-icon">{{ fileIcon(doc.mimeType) }}</mat-icon>
                <div>
                  <div class="file-name">{{ doc.filename }}</div>
                  <div class="file-size">{{ formatBytes(doc.sizeBytes) }}</div>
                </div>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="kind">
            <th mat-header-cell *matHeaderCellDef>Kind</th>
            <td mat-cell *matCellDef="let doc">
              <span class="kind-chip">{{ doc.kind }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let doc">
              <span class="status-chip" [class]="'status-' + doc.status.toLowerCase()">
                {{ doc.status }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="createdAt">
            <th mat-header-cell *matHeaderCellDef>Uploaded</th>
            <td mat-cell *matCellDef="let doc" class="date-cell">
              {{ doc.createdAt | date:'MMM d, y' }}
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef><span class="sr-only">Actions</span></th>
            <td mat-cell *matCellDef="let doc" class="actions-cell">
              <button mat-icon-button matTooltip="Download" (click)="download(doc)">
                <mat-icon>download</mat-icon>
              </button>
              <button mat-icon-button color="warn" matTooltip="Delete" (click)="confirmDelete(doc)">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="cols"></tr>
          <tr mat-row *matRowDef="let row; columns: cols;" class="doc-row"></tr>
        </table>
      </mat-card>
    </div>
  `,
  styles: [`
    .page-shell  { padding: 24px; max-width: 1000px; margin: 0 auto; }
    .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .page-title  { margin: 0; font-size: 24px; font-weight: 600; }
    .page-sub    { margin: 4px 0 0; color: #666; font-size: 13px; }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .hidden-input   { display: none; }
    .inline-spinner { display: inline-block; margin-right: 8px; vertical-align: middle; }

    .filter-card    { margin-bottom: 16px; }
    .filter-row     { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .matter-select  { flex: 1; min-width: 280px; }
    .doc-count      { color: #666; font-size: 13px; }

    .center-spinner { display: flex; justify-content: center; padding: 48px; }

    .empty-prompt {
      display: flex; flex-direction: column; align-items: center;
      padding: 64px 24px; color: #aaa; text-align: center;
    }
    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      padding: 56px 24px; color: #888; text-align: center;
    }
    .empty-icon { font-size: 56px; width: 56px; height: 56px; margin-bottom: 16px; opacity: 0.4; }
    .empty-prompt p, .empty-state p { margin: 0 0 20px; font-size: 15px; }

    .table-card  { overflow: hidden; }
    .docs-table  { width: 100%; }
    .doc-row:hover { background: rgba(0,0,0,.03); }

    .file-row  { display: flex; align-items: center; gap: 12px; }
    .file-icon { color: #888; font-size: 28px; width: 28px; height: 28px; }
    .file-name { font-weight: 500; font-size: 14px; }
    .file-size { font-size: 12px; color: #888; }

    .kind-chip {
      display: inline-block; padding: 2px 8px;
      background: #e8eaf6; color: #3949ab;
      border-radius: 10px; font-size: 11px; font-weight: 600;
    }
    .status-chip {
      display: inline-block; padding: 2px 8px;
      border-radius: 10px; font-size: 11px; font-weight: 600;
      background: #e8f5e9; color: #2e7d32;
    }

    .date-cell    { color: #777; font-size: 13px; white-space: nowrap; }
    .actions-cell { white-space: nowrap; }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }
  `],
})
export class DocumentsComponent implements OnInit {
  private docService    = inject(DocumentService);
  private matterService = inject(MatterService);
  private snack         = inject(MatSnackBar);

  matters       = signal<Matter[]>([]);
  documents     = signal<Document[]>([]);
  loading       = signal(false);
  loadingMatters = signal(true);
  uploading     = signal(false);

  matterCtrl = new FormControl<string | null>(null);
  cols = ['filename', 'kind', 'status', 'createdAt', 'actions'];

  ngOnInit(): void {
    this.matterService.getMatters({ limit: 200 })
      .pipe(catchError(() => of({ data: [] as Matter[], total: 0, limit: 200, offset: 0 })))
      .subscribe(page => {
        this.matters.set(page.data);
        this.loadingMatters.set(false);
      });

    this.matterCtrl.valueChanges
      .pipe(
        distinctUntilChanged(),
        filter((id): id is string => !!id),
        switchMap(id => {
          this.loading.set(true);
          return this.docService.getDocuments(id)
            .pipe(catchError(() => of([] as Document[])));
        })
      )
      .subscribe(docs => {
        this.documents.set(docs);
        this.loading.set(false);
      });
  }

  onFileSelected(input: HTMLInputElement): void {
    const file = input.files?.[0];
    const matterId = this.matterCtrl.value;
    if (!file || !matterId) return;

    const form = new FormData();
    form.append('file', file);
    form.append('matterId', matterId);

    this.uploading.set(true);
    this.docService.uploadDocument(form).subscribe({
      next: doc => {
        this.documents.update(ds => [doc, ...ds]);
        this.uploading.set(false);
        this.snack.open(`"${doc.filename}" uploaded.`, 'OK', { duration: 3000 });
        input.value = '';
      },
      error: err => {
        this.uploading.set(false);
        this.snack.open(err?.error?.message ?? 'Upload failed.', 'Dismiss', { duration: 4000 });
        input.value = '';
      },
    });
  }

  download(doc: Document): void {
    this.docService.getDownloadUrl(doc.id).subscribe({
      next: ({ url }) => window.open(url, '_blank'),
      error: () => this.snack.open('Could not get download link.', 'Dismiss', { duration: 3000 }),
    });
  }

  confirmDelete(doc: Document): void {
    const ref = this.snack.open(`Delete "${doc.filename}"?`, 'Delete', { duration: 5000 });
    ref.onAction().subscribe(() => {
      this.docService.deleteDocument(doc.id).subscribe({
        next: () => {
          this.documents.update(ds => ds.filter(d => d.id !== doc.id));
          this.snack.open('Document deleted.', 'OK', { duration: 2500 });
        },
        error: () => this.snack.open('Failed to delete document.', 'Dismiss', { duration: 3000 }),
      });
    });
  }

  fileIcon(mimeType: string): string {
    if (!mimeType) return 'insert_drive_file';
    if (mimeType.includes('pdf'))   return 'picture_as_pdf';
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'description';
    if (mimeType.includes('sheet') || mimeType.includes('excel'))   return 'table_chart';
    return 'insert_drive_file';
  }

  formatBytes(bytes: number): string {
    if (!bytes)              return '0 B';
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
