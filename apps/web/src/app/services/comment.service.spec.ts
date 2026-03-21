import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { CommentService, Comment, CommentPage } from './comment.service';

const mockComment: Comment = {
  id:        'c1',
  bodyMd:    'Hello world',
  authorId:  'u1',
  author:    { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
  matterId:  'm1',
  createdAt: new Date().toISOString(),
};

describe('CommentService', () => {
  let service: CommentService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CommentService);
    http    = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates successfully', () => expect(service).toBeTruthy());

  it('getComments sends GET with matterId query param', () => {
    const page: CommentPage = { data: [mockComment], total: 1, limit: 100, offset: 0 };
    service.getComments({ matterId: 'm1' }).subscribe(res => expect(res.data).toHaveLength(1));
    const req = http.expectOne(r => r.url === '/api/comments' && r.params.get('matterId') === 'm1');
    expect(req.request.method).toBe('GET');
    req.flush(page);
  });

  it('getComments sends GET with contractId query param', () => {
    service.getComments({ contractId: 'ct1' }).subscribe();
    const req = http.expectOne(r => r.params.get('contractId') === 'ct1');
    req.flush({ data: [], total: 0, limit: 100, offset: 0 });
  });

  it('createComment sends POST to /api/comments', () => {
    service.createComment({ bodyMd: 'Hi', matterId: 'm1' }).subscribe(c => expect(c.bodyMd).toBe('Hello world'));
    const req = http.expectOne('/api/comments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ bodyMd: 'Hi', matterId: 'm1' });
    req.flush(mockComment);
  });

  it('updateComment sends PATCH to /api/comments/:id', () => {
    service.updateComment('c1', 'Updated text').subscribe(c => expect(c.id).toBe('c1'));
    const req = http.expectOne('/api/comments/c1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ bodyMd: 'Updated text' });
    req.flush({ ...mockComment, bodyMd: 'Updated text' });
  });

  it('deleteComment sends DELETE to /api/comments/:id', () => {
    service.deleteComment('c1').subscribe();
    const req = http.expectOne('/api/comments/c1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
