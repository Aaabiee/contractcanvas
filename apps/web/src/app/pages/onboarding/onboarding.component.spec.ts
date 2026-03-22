import 'zone.js/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { OnboardingComponent } from './onboarding.component';
import { AuthService } from '../../services/auth.service';

describe('OnboardingComponent', () => {
  let fixture: ComponentFixture<OnboardingComponent>;
  let component: OnboardingComponent;
  let httpMock: HttpTestingController;
  let router: Router;
  let snack: { open: jest.Mock };

  beforeEach(async () => {
    snack = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'dashboard', component: OnboardingComponent }]),
        provideAnimationsAsync(),
        { provide: AuthService, useValue: { currentUser: signal({ id: 'u1', email: 'a@b.com' }) } },
      ],
    })
      .overrideComponent(OnboardingComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snack }] },
      })
      .compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    router   = TestBed.inject(Router);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture   = TestBed.createComponent(OnboardingComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('should create', () => expect(component).toBeTruthy());

  it('loads user and sets step index on init', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({
      onboardingStep: 'CREATE_MATTER',
      emailVerifiedAt: '2024-01-01',
    });
    tick();
    expect(component.stepIndex()).toBe(2);
    expect(component.emailVerified()).toBe(true);
  }));

  it('redirects to dashboard when step is DONE', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'DONE' });
    tick();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  }));

  it('advance sends PATCH to onboarding endpoint', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'VERIFY_EMAIL', emailVerifiedAt: '2024-01-01' });
    tick();

    component.advance('CUSTOMIZE_ORG');
    const req = httpMock.expectOne('/api/users/me/onboarding');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ step: 'CUSTOMIZE_ORG' });
    req.flush({ id: 'u1', onboardingStep: 'CUSTOMIZE_ORG' });
    tick();
    expect(component.stepIndex()).toBe(1);
  }));

  it('createMatter sends POST then advances', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'CREATE_MATTER', emailVerifiedAt: '2024-01-01' });
    tick();

    component.matterTitle.setValue('Test Matter');
    component.createMatter();

    const matterReq = httpMock.expectOne('/api/matters');
    expect(matterReq.request.method).toBe('POST');
    expect(matterReq.request.body.title).toBe('Test Matter');
    matterReq.flush({ id: 'm1', title: 'Test Matter' });
    tick();

    const advanceReq = httpMock.expectOne('/api/users/me/onboarding');
    advanceReq.flush({});
    tick();

    expect(snack.open).toHaveBeenCalledWith('Matter created!', 'OK', expect.any(Object));
  }));

  it('finishOnboarding patches DONE and navigates to dashboard', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'VERIFY_EMAIL' });
    tick();

    component.finishOnboarding();
    httpMock.expectOne('/api/users/me/onboarding').flush({});
    tick();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  }));

  it('finishOnboarding navigates even on error', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'VERIFY_EMAIL' });
    tick();

    component.finishOnboarding();
    httpMock.expectOne('/api/users/me/onboarding').flush('fail', { status: 500, statusText: 'Error' });
    tick();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  }));

  // ── Coverage: line 153 (onStepSelect) ──

  it('onStepSelect sets stepIndex to the given index', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'VERIFY_EMAIL' });
    tick();

    component.onStepSelect(3);
    expect(component.stepIndex()).toBe(3);
  }));

  // ── Coverage: line 162 (advance error) ──

  it('advance shows snackbar when PATCH fails', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'VERIFY_EMAIL', emailVerifiedAt: '2024-01-01' });
    tick();

    component.advance('CUSTOMIZE_ORG');
    httpMock.expectOne('/api/users/me/onboarding').flush('fail', { status: 500, statusText: 'Error' });
    tick();
    expect(snack.open).toHaveBeenCalledWith('Failed to update progress.', 'Dismiss', expect.any(Object));
  }));

  // ── Coverage: line 174 (createMatter error) ──

  it('createMatter shows snackbar on failure and resets saving', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'CREATE_MATTER', emailVerifiedAt: '2024-01-01' });
    tick();

    component.matterTitle.setValue('Test');
    component.createMatter();
    expect(component.saving()).toBe(true);

    httpMock.expectOne('/api/matters').flush('fail', { status: 500, statusText: 'Error' });
    tick();

    expect(component.saving()).toBe(false);
    expect(snack.open).toHaveBeenCalledWith('Failed.', 'Dismiss', expect.any(Object));
  }));

  // ── Coverage: lines 178-197 (inviteMember) ──

  it('inviteMember sends invite when orgs exist', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'INVITE_MEMBER', emailVerifiedAt: '2024-01-01' });
    tick();

    component.inviteEmail.setValue('colleague@firm.com');
    component.inviteMember();
    expect(component.saving()).toBe(true);

    const orgsReq = httpMock.expectOne('/api/organizations/me');
    orgsReq.flush([{ id: 'org-1', name: 'Test Org' }]);
    tick();

    const memberReq = httpMock.expectOne('/api/organizations/org-1/members');
    expect(memberReq.request.method).toBe('POST');
    expect(memberReq.request.body.email).toBe('colleague@firm.com');
    memberReq.flush({ id: 'mem-1' });
    tick();

    expect(component.saving()).toBe(false);
    expect(snack.open).toHaveBeenCalledWith('Invite sent!', 'OK', expect.any(Object));

    // Drain the advance PATCH triggered by inviteMember success
    httpMock.expectOne('/api/users/me/onboarding').flush({});
    tick();
  }));

  it('inviteMember resets saving when no orgs returned', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'INVITE_MEMBER', emailVerifiedAt: '2024-01-01' });
    tick();

    component.inviteEmail.setValue('colleague@firm.com');
    component.inviteMember();

    httpMock.expectOne('/api/organizations/me').flush([]);
    tick();

    expect(component.saving()).toBe(false);
  }));

  it('inviteMember advances even when invite POST fails', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/users/me').flush({ onboardingStep: 'INVITE_MEMBER', emailVerifiedAt: '2024-01-01' });
    tick();

    component.inviteEmail.setValue('colleague@firm.com');
    component.inviteMember();

    httpMock.expectOne('/api/organizations/me').flush([{ id: 'org-1', name: 'Test' }]);
    tick();

    httpMock.expectOne('/api/organizations/org-1/members').flush('fail', { status: 500, statusText: 'Error' });
    tick();

    expect(component.saving()).toBe(false);
    // Should still advance to UPLOAD_DOCUMENT
    httpMock.expectOne('/api/users/me/onboarding').flush({});
    tick();
  }));
});
