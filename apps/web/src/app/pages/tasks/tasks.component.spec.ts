import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  let snackBar: jest.Mocked<MatSnackBar>;

  beforeEach(async () => {
    const taskServiceMock = { getTasks: jest.fn(), completeTask: jest.fn(), reopenTask: jest.fn() };
    const snackMock       = { open: jest.fn() };

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
    snackBar    = TestBed.inject(MatSnackBar) as jest.Mocked<MatSnackBar>;
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

  it('isOverdue should return true for past due dates on incomplete tasks', () => {
    const task = { ...mockTasks[0], dueAt: '2020-01-01T00:00:00Z' };
    expect(component.isOverdue(task)).toBe(true);
  });

  it('isOverdue should return false for completed tasks', () => {
    const task = { ...mockTasks[0], dueAt: '2020-01-01T00:00:00Z', completedAt: new Date().toISOString() };
    expect(component.isOverdue(task)).toBe(false);
  });
});
