import 'zone.js/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TaskService, Task, TaskPage } from './task.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('TaskService', () => {
  let service: TaskService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api/tasks';

  const sampleTask: Task = {
    id: 'task-1', title: 'Review clause', description: null,
    matterId: 'matter-1', organizationId: 'org-1',
    assigneeId: null, dueAt: null, completedAt: null, createdAt: new Date().toISOString(),
  };

  const samplePage: TaskPage = { data: [sampleTask], total: 1, limit: 20, offset: 0 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), TaskService],
    });
    service  = TestBed.inject(TaskService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => expect(service).toBeTruthy());

  describe('getTasks()', () => {
    it('fetches paginated tasks', () => {
      service.getTasks().subscribe(page => {
        expect(page.data).toHaveLength(1);
        expect(page.total).toBe(1);
      });
      const req = httpMock.expectOne(r => r.url === apiUrl);
      expect(req.request.method).toBe('GET');
      req.flush(samplePage);
    });

    it('passes matterId filter', () => {
      service.getTasks({ matterId: 'matter-5' }).subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('matterId') === 'matter-5');
      req.flush({ data: [], total: 0, limit: 20, offset: 0 });
    });

    it('passes completed=false filter', () => {
      service.getTasks({ completed: false }).subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('completed') === 'false');
      req.flush({ data: [], total: 0, limit: 20, offset: 0 });
    });

    it('passes assigneeId filter', () => {
      service.getTasks({ assigneeId: 'user-5' }).subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('assigneeId') === 'user-5');
      req.flush({ data: [], total: 0, limit: 20, offset: 0 });
    });

    it('passes limit param', () => {
      service.getTasks({ limit: 5 }).subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('limit') === '5');
      req.flush({ data: [], total: 0, limit: 5, offset: 0 });
    });

    it('passes offset param', () => {
      service.getTasks({ offset: 20 }).subscribe();
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('offset') === '20');
      req.flush({ data: [], total: 0, limit: 20, offset: 20 });
    });
  });

  describe('getTask()', () => {
    it('fetches a single task by id', () => {
      service.getTask('task-1').subscribe(t => expect(t).toEqual(sampleTask));
      const req = httpMock.expectOne(`${apiUrl}/task-1`);
      expect(req.request.method).toBe('GET');
      req.flush(sampleTask);
    });
  });

  describe('updateTask()', () => {
    it('PATCHes the task with given payload', () => {
      const updated = { ...sampleTask, title: 'Updated title' };
      service.updateTask('task-1', { title: 'Updated title' }).subscribe(t => expect(t.title).toBe('Updated title'));
      const req = httpMock.expectOne(`${apiUrl}/task-1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'Updated title' });
      req.flush(updated);
    });
  });

  describe('createTask()', () => {
    it('POSTs and returns created task', () => {
      service.createTask({ title: 'New task', matterId: 'matter-1' }).subscribe(t => expect(t.id).toBe('task-1'));
      const req = httpMock.expectOne(apiUrl);
      expect(req.request.method).toBe('POST');
      req.flush(sampleTask);
    });
  });

  describe('completeTask()', () => {
    it('PATCHes completedAt to now', () => {
      const completed = { ...sampleTask, completedAt: new Date().toISOString() };
      service.completeTask('task-1').subscribe(t => expect(t.completedAt).toBeTruthy());
      const req = httpMock.expectOne(`${apiUrl}/task-1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toHaveProperty('completedAt');
      req.flush(completed);
    });
  });

  describe('reopenTask()', () => {
    it('PATCHes completedAt to null', () => {
      service.reopenTask('task-1').subscribe();
      const req = httpMock.expectOne(`${apiUrl}/task-1`);
      expect(req.request.body.completedAt).toBeNull();
      req.flush(sampleTask);
    });
  });

  describe('deleteTask()', () => {
    it('sends DELETE request', () => {
      let called = false;
      service.deleteTask('task-1').subscribe(() => (called = true));
      const req = httpMock.expectOne(`${apiUrl}/task-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      expect(called).toBe(true);
    });
  });
});
