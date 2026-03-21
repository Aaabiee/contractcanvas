import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { UpgradeDialogComponent } from './upgrade-dialog.component';

describe('UpgradeDialogComponent', () => {
  let fixture: ComponentFixture<UpgradeDialogComponent>;
  let component: UpgradeDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UpgradeDialogComponent],
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { error: 'LIMIT_EXCEEDED', limit: 10, current: 10 } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpgradeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('usagePercent returns 100 when at limit', () => {
    expect(component.usagePercent()).toBe(100);
  });

  it('usagePercent returns correct percentage', () => {
    component.data = { error: 'LIMIT_EXCEEDED', limit: 20, current: 5 };
    expect(component.usagePercent()).toBe(25);
  });

  it('usagePercent returns 100 when limit is 0', () => {
    component.data = { error: 'LIMIT_EXCEEDED', limit: 0, current: 0 };
    expect(component.usagePercent()).toBe(100);
  });

  it('usagePercent handles missing current', () => {
    component.data = { error: 'LIMIT_EXCEEDED', limit: 10 };
    expect(component.usagePercent()).toBe(0);
  });
});
