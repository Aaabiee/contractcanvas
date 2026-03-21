import 'zone.js/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DashboardHomeComponent } from './dashboard-home.component';
import { AuthService } from '../../services/auth.service';
import { MatterService } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { TaskService } from '../../services/task.service';
import { NotificationService } from '../../services/notification.service';

const mockCurrentUser = signal<any>(null);

const emptyPage      = { data: [], total: 0, limit: 1,  offset: 0 };
const emptyTaskPage  = { data: [], total: 0, limit: 10, offset: 0 };
const emptyNotifPage = { data: [], total: 0, unreadCount: 0, limit: 1, offset: 0 };

class MockAuthService {
  currentUser = mockCurrentUser;
  logout = jest.fn();
}

class MockMatterService {
  getMatters = jest.fn(() => of(emptyPage));
}

class MockContractService {
  getContracts = jest.fn(() => of(emptyPage));
}

class MockTaskService {
  getTasks = jest.fn(() => of(emptyTaskPage));
}

class MockNotificationService {
  unreadCount      = signal(0);
  getNotifications = jest.fn(() => of(emptyNotifPage));
}

describe('DashboardHomeComponent', () => {
  let component: DashboardHomeComponent;
  let fixture: ComponentFixture<DashboardHomeComponent>;
  let snackBar: { open: jest.Mock };
  let router: Router;

  beforeEach(async () => {
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [DashboardHomeComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService,         useClass: MockAuthService         },
        { provide: MatterService,       useClass: MockMatterService       },
        { provide: ContractService,     useClass: MockContractService     },
        { provide: TaskService,         useClass: MockTaskService         },
        { provide: NotificationService, useClass: MockNotificationService },
      ],
    })
      .overrideComponent(DashboardHomeComponent, {
        add: {
          providers: [
            { provide: MatSnackBar, useValue: snackBar },
          ],
        },
      })
      .compileComponents();

    fixture   = TestBed.createComponent(DashboardHomeComponent);
    component = fixture.componentInstance;
    router    = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('recentFiltered returns all items when searchValue is empty', () => {
    component.searchValue.set('');
    expect(component.recentFiltered().length).toBe(component.recent().length);
  });

  it('recentFiltered filters items by search term', () => {
    component.searchValue.set('nda');
    const filtered = component.recentFiltered();
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every(r => r.text.toLowerCase().includes('nda'))).toBe(true);
  });

  it('recentFiltered returns empty array for non-matching term', () => {
    component.searchValue.set('zzznomatch');
    expect(component.recentFiltered()).toHaveLength(0);
  });

  it('openTask shows a snackbar with the task title', () => {
    component.openTask({ title: 'Review NDA', id: 't1' });
    expect(snackBar.open).toHaveBeenCalledWith('Open task: Review NDA', 'OK', expect.any(Object));
  });

  it('markDone shows a snackbar with the task title', () => {
    component.markDone({ title: 'Send invoice', id: 't2' });
    expect(snackBar.open).toHaveBeenCalledWith('Marked done: Send invoice', 'Undo', expect.any(Object));
  });

  it('loadStats populates stats from API responses', () => {
    const matterService   = TestBed.inject(MatterService)       as unknown as MockMatterService;
    const contractService = TestBed.inject(ContractService)     as unknown as MockContractService;
    const taskService     = TestBed.inject(TaskService)         as unknown as MockTaskService;
    const notifService    = TestBed.inject(NotificationService) as unknown as MockNotificationService;

    matterService.getMatters.mockReturnValue(of({ data: [], total: 5, limit: 1, offset: 0 }));
    contractService.getContracts.mockReturnValue(of({ data: [], total: 3, limit: 1, offset: 0 }));
    taskService.getTasks.mockReturnValue(of({ data: [], total: 8, limit: 1, offset: 0 }));
    notifService.getNotifications.mockReturnValue(of({ data: [], total: 2, unreadCount: 2, limit: 1, offset: 0 }));

    component.loadStats();

    const stats = component.stats();
    expect(stats.find(s => s.label === 'Open Matters')!.value).toBe(5);
    expect(stats.find(s => s.label === 'Active Contracts')!.value).toBe(3);
    expect(stats.find(s => s.label === 'Pending Tasks')!.value).toBe(8);
    expect(stats.find(s => s.label === 'Unread Alerts')!.value).toBe(2);
  });

  it('loadStats handles matter service error gracefully', () => {
    const matterService = TestBed.inject(MatterService) as unknown as MockMatterService;
    matterService.getMatters.mockReturnValue(throwError(() => new Error('network error')));

    expect(() => component.loadStats()).not.toThrow();
    const stats = component.stats();
    expect(stats.find(s => s.label === 'Open Matters')!.value).toBe(0);
  });

  it('loadStats handles contracts service error gracefully', () => {
    const contractService = TestBed.inject(ContractService) as unknown as MockContractService;
    contractService.getContracts.mockReturnValue(throwError(() => new Error('fail')));
    expect(() => component.loadStats()).not.toThrow();
    expect(component.stats().find(s => s.label === 'Active Contracts')!.value).toBe(0);
  });

  it('loadStats handles tasks service error gracefully', () => {
    const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
    taskService.getTasks.mockReturnValue(throwError(() => new Error('fail')));
    expect(() => component.loadStats()).not.toThrow();
    expect(component.stats().find(s => s.label === 'Pending Tasks')!.value).toBe(0);
  });

  it('loadStats handles notification service error gracefully', () => {
    const notifService = TestBed.inject(NotificationService) as unknown as MockNotificationService;
    notifService.getNotifications.mockReturnValue(throwError(() => new Error('fail')));
    expect(() => component.loadStats()).not.toThrow();
    expect(component.stats().find(s => s.label === 'Unread Alerts')!.value).toBe(0);
  });

  it('statTrackBy returns the label', () => {
    expect(component.statTrackBy(0, { label: 'Open Matters', value: 5, icon: 'work', color: 'primary', link: '/' }))
      .toBe('Open Matters');
  });

  it('qaTrackBy returns the label', () => {
    expect(component.qaTrackBy(0, { label: 'New Matter', icon: 'add', tip: '', to: '/' })).toBe('New Matter');
  });

  it('recentTrackBy returns text + when concatenated', () => {
    expect(component.recentTrackBy(0, { text: 'Comment on NDA', when: '2h ago', icon: '', link: '/' }))
      .toBe('Comment on NDA2h ago');
  });

  it('filterPredicate matches row when any field contains the filter string', () => {
    component.ngAfterViewInit();
    const pred = component.dataSource.filterPredicate;
    const row  = { title: 'NDA Review', due: '1/1/2024', status: 'Pending', assignee: 'Alice', id: 't1' };
    expect(pred(row, 'nda')).toBe(true);
    expect(pred(row, 'xyz')).toBe(false);
  });

  it('ngOnInit maps tasks with dueAt, completedAt, and assignee branches', fakeAsync(() => {
    const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
    taskService.getTasks.mockReturnValue(of({
      data: [
        {
          id: 't1', title: 'Task A',
          dueAt: '2024-06-01T00:00:00Z',
          completedAt: '2024-05-01T00:00:00Z',
          assignee: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'a@b.com' },
        },
        {
          id: 't2', title: 'Task B',
          dueAt: null, completedAt: null, assignee: null,
        },
      ],
      total: 2, limit: 10, offset: 0,
    }));
    component.ngOnInit();
    tick();
    const rows = component.dataSource.data;
    expect(rows[0].due).not.toBe('—');
    expect(rows[0].status).toBe('Done');
    expect(rows[0].assignee).toBe('Alice Smith');
    expect(rows[1].due).toBe('—');
    expect(rows[1].status).toBe('Pending');
    expect(rows[1].assignee).toBe('Unassigned');
  }));

  it('ngOnInit tasks catchError returns empty data on task service error', fakeAsync(() => {
    const taskService = TestBed.inject(TaskService) as unknown as MockTaskService;
    taskService.getTasks.mockReturnValue(throwError(() => new Error('network')));
    component.ngOnInit();
    tick();
    expect(component.dataSource.data).toEqual([]);
  }));

  it('ngAfterViewInit sets dataSource.filter on search value change', fakeAsync(() => {
    component.ngAfterViewInit();
    component.search.setValue('test query');
    tick(300);
    expect(component.dataSource.filter).toBe('test query');
  }));

  it('goStatCard navigates when value >= 1', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    component.goStatCard({ value: 3, link: '/matters' });
    expect(navSpy).toHaveBeenCalledWith(['/matters']);
  });

  it('goStatCard does not navigate when value is 0', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    component.goStatCard({ value: 0, link: '/matters' });
    expect(navSpy).not.toHaveBeenCalled();
  });
});
