import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { MatterDetailComponent } from './matter-detail.component';
import { MatterService, Matter } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { DocumentService } from '../../services/document.service';
import { TaskService } from '../../services/task.service';
import { CommentService } from '../../services/comment.service';
import { AuthService } from '../../services/auth.service';

const mockMatter: Matter = {
  id: 'm1', title: 'Test Matter', status: 'OPEN', description: 'Test description',
};

const emptyPage = { data: [], total: 0, limit: 50, offset: 0 };

class MockMatterService {
  getMatter = jest.fn((id: string) => id === 'm1' ? of(mockMatter) : of(null as any));
}

class MockContractService {
  getContracts = jest.fn(() => of(emptyPage));
}

class MockDocumentService {
  getDocuments = jest.fn(() => of([]));
}

class MockTaskService {
  getTasks      = jest.fn(() => of(emptyPage));
  completeTask  = jest.fn(() => of({ id: 't1', completedAt: new Date().toISOString() }));
  reopenTask    = jest.fn(() => of({ id: 't1', completedAt: null }));
}

class MockCommentService {
  getComments = jest.fn(() => of({ data: [], total: 0, limit: 100, offset: 0 }));
  createComment = jest.fn(() => of({}));
  updateComment = jest.fn(() => of({}));
  deleteComment = jest.fn(() => of(undefined));
}

class MockAuthService {
  currentUser = signal<any>(null);
  silentRefresh = () => of(false);
}

describe('MatterDetailComponent', () => {
  let component: MatterDetailComponent;
  let fixture: ComponentFixture<MatterDetailComponent>;
  let matterService: MockMatterService;
  let paramMapSubject: Subject<any>;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function setup() {
    paramMapSubject = new Subject();
    await TestBed.configureTestingModule({
      imports: [MatterDetailComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MatterService,   useClass: MockMatterService   },
        { provide: ContractService, useClass: MockContractService  },
        { provide: DocumentService, useClass: MockDocumentService  },
        { provide: TaskService,     useClass: MockTaskService      },
        { provide: CommentService,  useClass: MockCommentService   },
        { provide: AuthService,     useClass: MockAuthService      },
        { provide: ActivatedRoute,  useValue: { paramMap: paramMapSubject.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MatterDetailComponent);
    component = fixture.componentInstance;
    matterService = TestBed.inject(MatterService) as unknown as MockMatterService;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('calls getMatter with the ID from the route', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    expect(matterService.getMatter).toHaveBeenCalledWith('m1');
  });

  it('displays the matter title, status, and description', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    fixture.detectChanges();
    const h2 = fixture.nativeElement.querySelector('h2');
    expect(h2.textContent).toBe('Test Matter');
    const badge = fixture.nativeElement.querySelector('.status-badge');
    expect(badge.textContent.trim()).toBe('OPEN');
    const desc = fixture.nativeElement.querySelector('.description');
    expect(desc.textContent).toBe('Test description');
  });

  it('sets error when no ID in route params', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({}));
    fixture.detectChanges();
    expect(component.error()).toBe('No Matter ID provided in URL.');
    expect(matterService.getMatter).not.toHaveBeenCalled();
  });

  it('sets error when getMatter fails', async () => {
    await setup();
    const errSubject = new Subject<Matter>();
    (TestBed.inject(MatterService) as unknown as MockMatterService).getMatter.mockReturnValue(
      errSubject.asObservable()
    );
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    errSubject.error(new Error('Not found'));
    fixture.detectChanges();
    expect(component.error()).toBe('Could not load matter details.');
  });

  it('shows empty contracts section and has no documents loaded', async () => {
    await setup();
    fixture.detectChanges();
    paramMapSubject.next(convertToParamMap({ id: 'm1' }));
    fixture.detectChanges();
    const firstEmpty = fixture.nativeElement.querySelector('.empty-state');
    expect(firstEmpty).toBeTruthy();
    expect(firstEmpty.textContent).toContain('No contracts');
    expect(component.documents()).toEqual([]);
  });

  describe('toggleTask()', () => {
    it('calls completeTask when task is not completed and updates task list', async () => {
      await setup();
      const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
      const task = { id: 't1', title: 'Todo', completedAt: null } as any;
      component.tasks.set([task]);
      const completedTask = { id: 't1', completedAt: new Date().toISOString() };
      taskService.completeTask.mockReturnValue(of(completedTask));

      component.toggleTask(task);

      expect(taskService.completeTask).toHaveBeenCalledWith('t1');
      expect(component.tasks()[0].completedAt).toBeTruthy();
    });

    it('calls reopenTask when task is completed and updates task list', async () => {
      await setup();
      const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
      const task = { id: 't1', title: 'Done', completedAt: '2026-01-01T00:00:00.000Z' } as any;
      component.tasks.set([task]);
      const reopenedTask = { id: 't1', completedAt: null };
      taskService.reopenTask.mockReturnValue(of(reopenedTask));

      component.toggleTask(task);

      expect(taskService.reopenTask).toHaveBeenCalledWith('t1');
      expect(component.tasks()[0].completedAt).toBeNull();
    });

    it('does not throw when completeTask fails', async () => {
      await setup();
      const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
      const task = { id: 't1', title: 'Todo', completedAt: null } as any;
      component.tasks.set([task]);
      taskService.completeTask.mockReturnValue(throwError(() => new Error('fail')));
      expect(() => component.toggleTask(task)).not.toThrow();
    });

    it('only updates the matching task when multiple tasks exist', async () => {
      await setup();
      const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
      const task1 = { id: 't1', title: 'Task 1', completedAt: null } as any;
      const task2 = { id: 't2', title: 'Task 2', completedAt: null } as any;
      const completedTask1 = { id: 't1', completedAt: new Date().toISOString() };
      component.tasks.set([task1, task2]);
      taskService.completeTask.mockReturnValue(of(completedTask1));
      component.toggleTask(task1);
      expect(component.tasks()[0].completedAt).toBeTruthy();
      expect(component.tasks()[1].completedAt).toBeNull();
    });
  });

  describe('loadAll() fallback branches', () => {
    it('uses result.contracts directly when it has no .data property (array response)', async () => {
      await setup();
      (TestBed.inject(ContractService) as unknown as MockContractService).getContracts
        .mockReturnValue(of([] as any));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.contracts()).toEqual([]);
      expect(component.matter()).toBeTruthy();
    });

    it('handles documents as object with data array (non-array response)', async () => {
      await setup();
      (TestBed.inject(DocumentService) as unknown as MockDocumentService).getDocuments
        .mockReturnValue(of({ data: [] } as any));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.documents()).toEqual([]);
    });

    it('handles documents as object without data property', async () => {
      await setup();
      (TestBed.inject(DocumentService) as unknown as MockDocumentService).getDocuments
        .mockReturnValue(of({} as any));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.documents()).toEqual([]);
    });

    it('uses result.tasks directly when it has no .data property (array response)', async () => {
      await setup();
      (TestBed.inject(TaskService) as unknown as MockTaskService).getTasks
        .mockReturnValue(of([] as any));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.tasks()).toEqual([]);
    });
  });

  describe('loadAll() catchError branches', () => {
    it('continues with empty contracts when contractService throws', async () => {
      await setup();
      (TestBed.inject(ContractService) as unknown as MockContractService).getContracts
        .mockReturnValue(throwError(() => new Error('fail')));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.contracts()).toEqual([]);
      expect(component.matter()).toBeTruthy();
    });

    it('continues with empty documents when documentService throws', async () => {
      await setup();
      (TestBed.inject(DocumentService) as unknown as MockDocumentService).getDocuments
        .mockReturnValue(throwError(() => new Error('fail')));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.documents()).toEqual([]);
    });

    it('continues with empty tasks when taskService throws', async () => {
      await setup();
      (TestBed.inject(TaskService) as unknown as MockTaskService).getTasks
        .mockReturnValue(throwError(() => new Error('fail')));
      fixture.detectChanges();
      paramMapSubject.next(convertToParamMap({ id: 'm1' }));
      fixture.detectChanges();
      expect(component.tasks()).toEqual([]);
    });
  });

  describe('formatBytes()', () => {
    let comp: MatterDetailComponent;
    beforeEach(async () => {
      await setup();
      comp = component;
    });

    it('formats 0 bytes', () => {
      expect(comp.formatBytes(0)).toBe('0 B');
    });

    it('formats bytes under 1 KB', () => {
      expect(comp.formatBytes(500)).toBe('500 B');
    });

    it('formats bytes in KB range', () => {
      expect(comp.formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats bytes in MB range', () => {
      expect(comp.formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    });

    it('formats exactly 1024 bytes as KB', () => {
      expect(comp.formatBytes(1024)).toBe('1.0 KB');
    });
  });

  describe('isOverdue()', () => {
    let comp: MatterDetailComponent;
    beforeEach(async () => {
      await setup();
      comp = component;
    });

    it('returns false when task has no dueAt', () => {
      const task = { id: 't1', completedAt: null, dueAt: null } as any;
      expect(comp.isOverdue(task)).toBe(false);
    });

    it('returns false when task is already completed', () => {
      const task = { id: 't1', completedAt: '2026-01-01T00:00:00.000Z', dueAt: '2020-01-01T00:00:00.000Z' } as any;
      expect(comp.isOverdue(task)).toBe(false);
    });

    it('returns true when past dueAt and not completed', () => {
      const task = { id: 't1', completedAt: null, dueAt: '2020-01-01T00:00:00.000Z' } as any;
      expect(comp.isOverdue(task)).toBe(true);
    });

    it('returns false when dueAt is in the future and not completed', () => {
      const task = { id: 't1', completedAt: null, dueAt: '2099-01-01T00:00:00.000Z' } as any;
      expect(comp.isOverdue(task)).toBe(false);
    });
  });

  describe('statusColor()', () => {
    let comp: MatterDetailComponent;
    beforeEach(async () => {
      await setup();
      comp = component;
    });

    it('returns "primary" for OPEN', () => {
      expect(comp.statusColor('OPEN')).toBe('primary');
    });

    it('returns "accent" for ON_HOLD', () => {
      expect(comp.statusColor('ON_HOLD')).toBe('accent');
    });

    it('returns "warn" for CLOSED', () => {
      expect(comp.statusColor('CLOSED')).toBe('warn');
    });

    it('returns "primary" for DRAFT', () => {
      expect(comp.statusColor('DRAFT')).toBe('primary');
    });

    it('returns "accent" for EXECUTED', () => {
      expect(comp.statusColor('EXECUTED')).toBe('accent');
    });

    it('returns "warn" for ARCHIVED', () => {
      expect(comp.statusColor('ARCHIVED')).toBe('warn');
    });

    it('returns "primary" for unknown status', () => {
      expect(comp.statusColor('UNKNOWN_XYZ')).toBe('primary');
    });
  });
});
