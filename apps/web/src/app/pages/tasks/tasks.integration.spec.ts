/**
 * Component integration tests for TasksComponent.
 *
 * Uses a REAL TaskService with HttpTestingController to verify
 * the full component → service → HTTP request chain.
 */

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { TasksComponent } from './tasks.component';
import { TaskService } from '../../services/task.service';

const taskPage = (data: any[]) => ({ data, total: data.length, limit: 20, offset: 0 });

const mockTask = {
  id: 't1', title: 'Review NDA', description: null,
  matterId: 'm1', organizationId: 'o1', assigneeId: null,
  dueAt: null, completedAt: null,
  createdAt: '2024-01-01T00:00:00Z',
  matter: { id: 'm1', title: 'Acme Matter' },
  assignee: null,
};

describe('TasksComponent (integration — real TaskService)', () => {
  let fixture:   ComponentFixture<TasksComponent>;
  let component: TasksComponent;
  let httpMock:  HttpTestingController;
  let snackBar:  { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [TasksComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        TaskService,
      ],
    })
      .overrideComponent(TasksComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    httpMock  = TestBed.inject(HttpTestingController);
    fixture   = TestBed.createComponent(TasksComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('sends GET /api/tasks on init and populates the task list', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === '/api/tasks');
    expect(req.request.method).toBe('GET');
    req.flush(taskPage([mockTask]));
    tick();

    expect(component.tasks()).toHaveLength(1);
    expect(component.total()).toBe(1);
    expect(component.loading()).toBe(false);
  }));

  it('passes limit and offset query params', fakeAsync(() => {
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url === '/api/tasks');
    expect(req.request.params.has('limit')).toBe(true);
    expect(req.request.params.has('offset')).toBe(true);
    req.flush(taskPage([]));
    tick();
  }));

  it('sets error signal when HTTP request fails', fakeAsync(() => {
    fixture.detectChanges();
    httpMock
      .expectOne(r => r.url === '/api/tasks')
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    tick();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
  }));

  it('filter=completed sends completed=true query param via debounce', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([]));
    tick();

    // setValue triggers debounced valueChanges → load()
    component.filter.setValue('completed');
    tick(200); // advance past debounce (100 ms)

    const req = httpMock.expectOne(r => r.url === '/api/tasks');
    expect(req.request.params.get('completed')).toBe('true');
    req.flush(taskPage([]));
    tick();
  }));

  it('filter=pending sends completed=false query param via debounce', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([]));
    tick();

    component.filter.setValue('pending');
    tick(200);

    const req = httpMock.expectOne(r => r.url === '/api/tasks');
    expect(req.request.params.get('completed')).toBe('false');
    req.flush(taskPage([]));
    tick();
  }));

  it('filter=all does not send completed query param', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([]));
    tick();

    // Switch to 'pending' first so changing back to 'all' fires distinctUntilChanged
    component.filter.setValue('pending');
    tick(200);
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([]));
    tick();

    component.filter.setValue('all');
    tick(200);

    const req = httpMock.expectOne(r => r.url === '/api/tasks');
    expect(req.request.params.has('completed')).toBe(false);
    req.flush(taskPage([]));
    tick();
  }));

  it('toggleComplete sends PATCH /api/tasks/:id for incomplete task and updates list', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([mockTask]));
    tick();

    const completedTask = { ...mockTask, completedAt: new Date().toISOString() };
    component.toggleComplete(mockTask);

    const req = httpMock.expectOne(r => r.url === '/api/tasks/t1');
    expect(req.request.method).toBe('PATCH');
    req.flush(completedTask);
    tick();

    expect(component.tasks()[0].completedAt).not.toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith('Task completed.', 'OK', expect.any(Object));
  }));

  it('toggleComplete sends PATCH /api/tasks/:id for completed task (reopen) and updates list', fakeAsync(() => {
    const completedTask = { ...mockTask, completedAt: '2024-01-01T12:00:00Z' };
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([completedTask]));
    tick();

    const reopenedTask = { ...completedTask, completedAt: null };
    component.toggleComplete(completedTask);

    const req = httpMock.expectOne(r => r.url === '/api/tasks/t1');
    expect(req.request.method).toBe('PATCH');
    req.flush(reopenedTask);
    tick();

    expect(component.tasks()[0].completedAt).toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith('Task reopened.', 'OK', expect.any(Object));
  }));

  it('toggleComplete shows error snackbar on HTTP failure', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([mockTask]));
    tick();

    component.toggleComplete(mockTask);
    httpMock
      .expectOne(r => r.url === '/api/tasks/t1')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    expect(snackBar.open).toHaveBeenCalledWith('Could not update task.', 'Dismiss', expect.any(Object));
  }));

  it('next() sends GET /api/tasks with incremented offset', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/tasks').flush(taskPage([]));
    tick();

    component.next();
    const req = httpMock.expectOne(r => r.url === '/api/tasks');
    expect(Number(req.request.params.get('offset'))).toBe(20);
    req.flush(taskPage([]));
    tick();
  }));

  it('isOverdue returns true for past due dates on incomplete tasks', () => {
    const task = { ...mockTask, dueAt: '2020-01-01T00:00:00Z' };
    expect(component.isOverdue(task)).toBe(true);
  });

  it('isOverdue returns false for completed tasks regardless of due date', () => {
    const task = { ...mockTask, dueAt: '2020-01-01T00:00:00Z', completedAt: new Date().toISOString() };
    expect(component.isOverdue(task)).toBe(false);
  });
});
