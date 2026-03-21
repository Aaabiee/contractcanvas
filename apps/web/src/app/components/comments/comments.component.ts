import {
  Component,
  Input,
  OnInit,
  OnChanges,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CommentService, Comment } from '../../services/comment.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-comments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="comments-container">
      <ng-container *ngIf="loading()">
        <mat-spinner diameter="32" style="margin:16px auto"></mat-spinner>
      </ng-container>

      <ng-container *ngIf="!loading()">
        <div *ngIf="comments().length === 0" class="no-comments">
          No comments yet. Be the first to comment.
        </div>

        <div *ngFor="let c of comments()" class="comment-item">
          <div class="comment-header">
            <span class="author">{{ c.author.firstName }} {{ c.author.lastName }}</span>
            <span class="timestamp">{{ c.createdAt | date:'medium' }}
              <span *ngIf="c.editedAt" class="edited">(edited)</span>
            </span>
          </div>

          <ng-container *ngIf="editingId() !== c.id">
            <p class="comment-body">{{ c.bodyMd }}</p>
            <div *ngIf="c.authorId === currentUserId()" class="comment-actions">
              <button mat-button (click)="startEdit(c)">
                <mat-icon>edit</mat-icon> Edit
              </button>
              <button mat-button color="warn" (click)="deleteComment(c.id)">
                <mat-icon>delete</mat-icon> Delete
              </button>
            </div>
          </ng-container>

          <ng-container *ngIf="editingId() === c.id">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Edit comment</mat-label>
              <textarea matInput [(ngModel)]="editBody" rows="3"></textarea>
            </mat-form-field>
            <div class="edit-actions">
              <button mat-raised-button color="primary" (click)="saveEdit(c.id)" [disabled]="!editBody.trim()">Save</button>
              <button mat-button (click)="cancelEdit()">Cancel</button>
            </div>
          </ng-container>
        </div>

        <mat-form-field appearance="outline" class="full-width new-comment">
          <mat-label>Add a comment</mat-label>
          <textarea matInput [(ngModel)]="newBody" rows="3" placeholder="Write a comment…"></textarea>
        </mat-form-field>
        <button mat-raised-button color="primary" (click)="submitComment()" [disabled]="!newBody.trim() || submitting()">
          {{ submitting() ? 'Posting…' : 'Post Comment' }}
        </button>
      </ng-container>
    </div>
  `,
  styles: [`
    .comments-container { padding: 8px 0; }
    .no-comments { color: #888; font-style: italic; margin: 16px 0; }
    .comment-item { border-left: 3px solid #e0e0e0; padding: 8px 12px; margin-bottom: 12px; }
    .comment-header { display: flex; gap: 12px; align-items: center; margin-bottom: 4px; }
    .author { font-weight: 500; }
    .timestamp { font-size: 12px; color: #888; }
    .edited { font-style: italic; }
    .comment-body { margin: 4px 0 8px; white-space: pre-wrap; }
    .comment-actions { display: flex; gap: 4px; }
    .edit-actions { display: flex; gap: 8px; margin-top: 8px; }
    .full-width { width: 100%; }
    .new-comment { margin-top: 16px; }
  `],
})
export class CommentsComponent implements OnInit, OnChanges {
  @Input() matterId?:   string;
  @Input() contractId?: string;

  private commentService = inject(CommentService);
  private authService    = inject(AuthService);
  private snack          = inject(MatSnackBar);

  comments   = signal<Comment[]>([]);
  loading    = signal(true);
  submitting = signal(false);
  editingId  = signal<string | null>(null);

  newBody  = '';
  editBody = '';

  currentUserId = computed(() => this.authService.currentUser()?.id ?? '');

  ngOnInit(): void {
    this.load();
  }

  ngOnChanges(): void {
    this.load();
  }

  load(): void {
    if (!this.matterId && !this.contractId) { this.loading.set(false); return; }
    this.loading.set(true);
    this.commentService.getComments({
      matterId:   this.matterId,
      contractId: this.contractId,
      limit:      100,
    }).subscribe({
      next: page => { this.comments.set(page.data); this.loading.set(false); },
      error: ()   => { this.loading.set(false); },
    });
  }

  submitComment(): void {
    if (!this.newBody.trim()) return;
    this.submitting.set(true);
    this.commentService.createComment({
      bodyMd:     this.newBody.trim(),
      matterId:   this.matterId,
      contractId: this.contractId,
    }).subscribe({
      next: comment => {
        this.comments.update(list => [...list, comment]);
        this.newBody = '';
        this.submitting.set(false);
      },
      error: () => {
        this.submitting.set(false);
        this.snack.open('Could not post comment.', 'Dismiss', { duration: 2500 });
      },
    });
  }

  startEdit(c: Comment): void {
    this.editingId.set(c.id);
    this.editBody = c.bodyMd;
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editBody = '';
  }

  saveEdit(id: string): void {
    if (!this.editBody.trim()) return;
    this.commentService.updateComment(id, this.editBody.trim()).subscribe({
      next: updated => {
        this.comments.update(list => list.map(c => c.id === id ? updated : c));
        this.cancelEdit();
      },
      error: () => this.snack.open('Could not update comment.', 'Dismiss', { duration: 2500 }),
    });
  }

  deleteComment(id: string): void {
    this.commentService.deleteComment(id).subscribe({
      next: () => this.comments.update(list => list.filter(c => c.id !== id)),
      error: () => this.snack.open('Could not delete comment.', 'Dismiss', { duration: 2500 }),
    });
  }
}
