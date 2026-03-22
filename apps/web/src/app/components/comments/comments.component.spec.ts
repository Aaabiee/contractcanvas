import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CommentsComponent } from './comments.component';
import { CommentService, Comment } from '../../services/comment.service';
import { AuthService } from '../../services/auth.service';

const mockComments: Comment[] = [
  {
    id:        'c1',
    bodyMd:    'First comment',
    authorId:  'u1',
    author:    { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'a@b.com' },
    matterId:  'm1',
    createdAt: new Date().toISOString(),
  },
];

class MockCommentService {
  getComments = jest.fn().mockReturnValue(of({ data: mockComments, total: 1, limit: 100, offset: 0 }));
  createComment = jest.fn().mockReturnValue(of({ ...mockComments[0], id: 'c2', bodyMd: 'New comment' }));
  updateComment = jest.fn().mockReturnValue(of({ ...mockComments[0], bodyMd: 'Edited' }));
  deleteComment = jest.fn().mockReturnValue(of(undefined));
}

class MockAuthService {
  currentUser = signal<any>({ id: 'u1', email: 'a@b.com' });
  silentRefresh = () => of(false);
}

describe('CommentsComponent', () => {
  let fixture: ComponentFixture<CommentsComponent>;
  let component: CommentsComponent;
  let commentService: MockCommentService;
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [CommentsComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: CommentService, useClass: MockCommentService },
        { provide: AuthService, useClass: MockAuthService },
      ],
    })
      .overrideComponent(CommentsComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    fixture       = TestBed.createComponent(CommentsComponent);
    component     = fixture.componentInstance;
    commentService = TestBed.inject(CommentService) as unknown as MockCommentService;

    component.matterId = 'm1';
    fixture.detectChanges();
  });

  it('creates successfully', () => expect(component).toBeTruthy());

  it('loads comments on init', () => {
    expect(commentService.getComments).toHaveBeenCalledWith(expect.objectContaining({ matterId: 'm1' }));
    expect(component.comments()).toHaveLength(1);
  });

  it('adds a new comment on submit', () => {
    component.newBody = 'New comment';
    component.submitComment();
    expect(commentService.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ bodyMd: 'New comment', matterId: 'm1' })
    );
    expect(component.comments()).toHaveLength(2);
    expect(component.newBody).toBe('');
  });

  it('does not submit when body is empty', () => {
    component.newBody = '   ';
    component.submitComment();
    expect(commentService.createComment).not.toHaveBeenCalled();
  });

  it('sets editingId when starting edit', () => {
    component.startEdit(mockComments[0]);
    expect(component.editingId()).toBe('c1');
    expect(component.editBody).toBe('First comment');
  });

  it('clears editingId on cancel', () => {
    component.startEdit(mockComments[0]);
    component.cancelEdit();
    expect(component.editingId()).toBeNull();
  });

  it('saves edit and clears editing state', () => {
    component.startEdit(mockComments[0]);
    component.editBody = 'Edited';
    component.saveEdit('c1');
    expect(commentService.updateComment).toHaveBeenCalledWith('c1', 'Edited');
    expect(component.editingId()).toBeNull();
  });

  it('deletes comment', () => {
    component.deleteComment('c1');
    expect(commentService.deleteComment).toHaveBeenCalledWith('c1');
    expect(component.comments()).toHaveLength(0);
  });

  it('does not load when neither matterId nor contractId is provided', () => {
    commentService.getComments.mockClear();
    component.matterId   = undefined;
    component.contractId = undefined;
    component.load();
    expect(commentService.getComments).not.toHaveBeenCalled();
    expect(component.loading()).toBe(false);
  });

  it('handles load error by setting loading to false (line 141)', () => {
    commentService.getComments.mockReturnValue(throwError(() => new Error('network')));
    component.loading.set(true);
    component.load();
    expect(component.loading()).toBe(false);
  });

  it('handles submitComment error by resetting submitting and showing snackbar (lines 159-160)', () => {
    commentService.createComment.mockReturnValue(throwError(() => new Error('fail')));
    component.newBody = 'Test comment';
    component.submitComment();
    expect(component.submitting()).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Could not post comment.', 'Dismiss', expect.any(Object));
  });

  it('handles saveEdit error by showing snackbar (line 182)', () => {
    commentService.updateComment.mockReturnValue(throwError(() => new Error('fail')));
    component.startEdit(mockComments[0]);
    component.editBody = 'Updated body';
    component.saveEdit('c1');
    expect(component.editingId()).toBe('c1'); // editing state not cleared on error
    expect(snackBar.open).toHaveBeenCalledWith('Could not update comment.', 'Dismiss', expect.any(Object));
  });

  it('handles deleteComment error by showing snackbar (line 189)', () => {
    commentService.deleteComment.mockReturnValue(throwError(() => new Error('fail')));
    component.comments.set([...mockComments]);
    component.deleteComment('c1');
    expect(component.comments()).toHaveLength(1); // comment not removed on error
    expect(snackBar.open).toHaveBeenCalledWith('Could not delete comment.', 'Dismiss', expect.any(Object));
  });
});
