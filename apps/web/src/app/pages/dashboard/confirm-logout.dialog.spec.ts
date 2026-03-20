import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ConfirmLogoutDialogComponent, ConfirmLogoutData } from './confirm-logout.dialog';

function buildComponent(data: ConfirmLogoutData | null = null) {
  const closeFn = jest.fn();
  TestBed.configureTestingModule({
    imports: [ConfirmLogoutDialogComponent, NoopAnimationsModule],
    providers: [
      { provide: MatDialogRef, useValue: { close: closeFn } },
      { provide: MAT_DIALOG_DATA, useValue: data },
    ],
  });
  const fixture = TestBed.createComponent(ConfirmLogoutDialogComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, closeFn };
}

describe('ConfirmLogoutDialogComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('default labels (no data provided)', () => {
    it('uses default title "Sign out?"', () => {
      const { component } = buildComponent(null);
      expect(component.title).toBe('Sign out?');
    });

    it('uses default message', () => {
      const { component } = buildComponent(null);
      expect(component.message).toBe('You will be signed out of your session.');
    });

    it('uses default logoutLabel "Sign out"', () => {
      const { component } = buildComponent(null);
      expect(component.logoutLabel).toBe('Sign out');
    });

    it('uses default cancelLabel "Cancel"', () => {
      const { component } = buildComponent(null);
      expect(component.cancelLabel).toBe('Cancel');
    });
  });

  describe('custom labels from injected data', () => {
    const customData: ConfirmLogoutData = {
      title:       'Really leave?',
      message:     'Your changes may be lost.',
      logoutLabel: 'Yes, leave',
      cancelLabel: 'Stay',
    };

    it('uses custom title', () => {
      const { component } = buildComponent(customData);
      expect(component.title).toBe('Really leave?');
    });

    it('uses custom message', () => {
      const { component } = buildComponent(customData);
      expect(component.message).toBe('Your changes may be lost.');
    });

    it('uses custom logoutLabel', () => {
      const { component } = buildComponent(customData);
      expect(component.logoutLabel).toBe('Yes, leave');
    });

    it('uses custom cancelLabel', () => {
      const { component } = buildComponent(customData);
      expect(component.cancelLabel).toBe('Stay');
    });
  });

  describe('confirm()', () => {
    it('closes the dialog with true', () => {
      const { component, closeFn } = buildComponent();
      component.confirm();
      expect(closeFn).toHaveBeenCalledWith(true);
    });
  });

  describe('cancel()', () => {
    it('closes the dialog with false', () => {
      const { component, closeFn } = buildComponent();
      component.cancel();
      expect(closeFn).toHaveBeenCalledWith(false);
    });
  });
});
