import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TasksComponent } from './tasks.component';
import { TaskService } from '../../services/task.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

const mockTasks = [
  {
    id: 'task-1', title: 'Draft contract', description: null, matterId: 'matter-1',
    organizationId: 'org-1', assigneeId: null, dueAt: null, completedAt: null,
    createdAt: new Date().toISOString(),
    matter: { id: 'matter-1', title: 'Acme Matter' },
    assignee: null,
  },
];

describe('TasksComponent', () => {
  let fixture: ComponentFixture<TasksComponent>;
  let component: TasksComponent;
  let taskService: jest.Mocked<TaskService>;
  let snackMock: { open: jest.Mock };

  beforeEach(async () => {
    const taskServiceMock = { getTasks: jest.fn(), completeTask: jest.fn(), reopenTask: jest.fn() };
    snackMock = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [TasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimations(),
        provideRouter([]),
        { provide: TaskService, useValue: taskServiceMock },
      ],
    })
      .overrideComponent(TasksComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackMock }] },
      })
      .compileComponents();

    taskService = TestBed.inject(TaskService) as jest.Mocked<TaskService>;
    fixture     = TestBed.createComponent(TasksComponent);
    component   = fixture.componentInstance;
  });

  it('should create', () => {
    taskService.getTasks.mockReturnValue(of({ data: [], total: 0, limit: 20, offset: 0 }));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should load tasks on init', () => {
    taskService.getTasks.mockReturnValue(of({ data: mockTasks, total: 1, limit: 20, offset: 0 }));
    fixture.detectChanges();
    expect(component.tasks()).toHaveLength(1);
    expect(component.total()).toBe(1);
    expect(component.loading()).toBe(false);
  });

  it('should show error on load failure', () => {
    taskService.getTasks.mockReturnValue(throwError(() => new Error('Network error')));
    fixture.detectChanges();
    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
  });

  it('load() with filter=completed passes completed=true to getTasks', () => {
    taskService.getTasks.mockReturnValue(of({ data: [], total: 0, limit: 20, offset: 0 }));
    component.filter.setValue('completed');
    component.load();
    expect(taskService.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ completed: true })
    );
  });

  it('load() with filter=pending passes completed=false to getTasks', () => {
    taskService.getTasks.mockReturnValue(of({ data: [], total: 0, limit: 20, offset: 0 }));
    component.filter.setValue('pending');
    component.load();
    expect(taskService.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ completed: false })
    );
  });

  it('load() with filter=all passes completed=undefined to getTasks', () => {
    taskService.getTasks.mockReturnValue(of({ data: [], total: 0, limit: 20, offset: 0 }));
    component.filter.setValue('all');
    component.load();
    expect(taskService.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ completed: undefined })
    );
  });

  it('toggleComplete should call completeTask for incomplete task', () => {
    taskService.getTasks.mockReturnValue(of({ data: mockTasks, total: 1, limit: 20, offset: 0 }));
    taskService.completeTask.mockReturnValue(of({ ...mockTasks[0], completedAt: new Date().toISOString() }));
    fixture.detectChanges();
    component.toggleComplete(mockTasks[0]);
    expect(taskService.completeTask).toHaveBeenCalledWith('task-1');
  });

  it('toggleComplete should call reopenTask for completed task', () => {
    const completedTask = { ...mockTasks[0], completedAt: new Date().toISOString() };
    taskService.getTasks.mockReturnValue(of({ data: [completedTask], total: 1, limit: 20, offset: 0 }));
    taskService.reopenTask.mockReturnValue(of({ ...completedTask, completedAt: null }));
    fixture.detectChanges();
    component.toggleComplete(completedTask);
    expect(taskService.reopenTask).toHaveBeenCalledWith('task-1');
  });

  it('toggleComplete updates task list on success', () => {
    const updatedTask = { ...mockTasks[0], completedAt: new Date().toISOString() };
    taskService.getTasks.mockReturnValue(of({ data: mockTasks, total: 1, limit: 20, offset: 0 }));
    taskService.completeTask.mockReturnValue(of(updatedTask));
    fixture.detectChanges();
    component.toggleComplete(mockTasks[0]);
    expect(component.tasks()[0].completedAt).toBeTruthy();
    expect(snackMock.open).toHaveBeenCalledWith('Task completed.', 'OK', expect.any(Object));
  });

  it('toggleComplete shows error snackbar on failure', () => {
    taskService.getTasks.mockReturnValue(of({ data: mockTasks, total: 1, limit: 20, offset: 0 }));
    taskService.completeTask.mockReturnValue(throwError(() => new Error('fail')));
    fixture.detectChanges();
    component.toggleComplete(mockTasks[0]);
    expect(snackMock.open).toHaveBeenCalledWith('Could not update task.', 'Dismiss', expect.any(Object));
  });

  it('toggleComplete shows Task reopened snackbar when task is reopened', () => {
    const completedTask = { ...mockTasks[0], completedAt: '2026-01-01T00:00:00Z' };
    const reopenedTask = { ...mockTasks[0], completedAt: null };
    taskService.getTasks.mockReturnValue(of({ data: [completedTask], total: 1, limit: 20, offset: 0 }));
    taskService.reopenTask.mockReturnValue(of(reopenedTask));
    fixture.detectChanges();
    component.toggleComplete(completedTask);
    expect(snackMock.open).toHaveBeenCalledWith('Task reopened.', 'OK', expect.any(Object));
  });

  it('toggleComplete only updates the matching task when multiple tasks exist', () => {
    const task1 = { ...mockTasks[0], id: 'task-1' };
    const task2 = { ...mockTasks[0], id: 'task-2', title: 'Task 2' };
    const updatedTask1 = { ...task1, completedAt: new Date().toISOString() };
    taskService.getTasks.mockReturnValue(of({ data: [task1, task2], total: 2, limit: 20, offset: 0 }));
    taskService.completeTask.mockReturnValue(of(updatedTask1));
    fixture.detectChanges();
    component.toggleComplete(task1);
    expect(component.tasks()[0].completedAt).toBeTruthy();
    expect(component.tasks()[1].completedAt).toBeNull();
  });

  it('isOverdue should return true for past due dates on incomplete tasks', () => {
    const task = { ...mockTasks[0], dueAt: '2020-01-01T00:00:00Z' };
    expect(component.isOverdue(task)).toBe(true);
  });

  it('isOverdue should return false for completed tasks', () => {
    const task = { ...mockTasks[0], dueAt: '2020-01-01T00:00:00Z', completedAt: new Date().toISOString() };
    expect(component.isOverdue(task)).toBe(false);
  });

  it('isOverdue should return false when dueAt is null', () => {
    expect(component.isOverdue(mockTasks[0])).toBe(false);
  });

  it('taskById returns the task id', () => {
    expect(component.taskById(0, mockTasks[0] as any)).toBe('task-1');
  });

  it('prev() decrements offset and reloads', () => {
    taskService.getTasks.mockReturnValue(of({ data: [], total: 0, limit: 20, offset: 0 }));
    component.offset.set(20);
    component.prev();
    expect(component.offset()).toBe(0);
    expect(taskService.getTasks).toHaveBeenCalled();
  });

  it('next() increments offset and reloads', () => {
    taskService.getTasks.mockReturnValue(of({ data: [], total: 0, limit: 20, offset: 0 }));
    component.offset.set(0);
    component.next();
    expect(component.offset()).toBe(20);
    expect(taskService.getTasks).toHaveBeenCalled();
  });
});
