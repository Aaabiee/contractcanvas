import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BillingComponent } from './billing.component';
import { BillingService } from '../../services/billing.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

// Provide a clipboard mock since jsdom doesn't implement navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: jest.fn().mockResolvedValue(undefined) },
  configurable: true,
});

const mockInvoice = { clientSecret: 'pi_test_secret', invoiceId: 'inv-1', amountCents: 50000, currency: 'usd' };

describe('BillingComponent', () => {
  let fixture: ComponentFixture<BillingComponent>;
  let component: BillingComponent;
  let billingServiceMock: { createInvoice: jest.Mock };
  let snackMock: { open: jest.Mock };

  beforeEach(async () => {
    billingServiceMock = { createInvoice: jest.fn() };
    snackMock          = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [BillingComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimations(),
        { provide: BillingService, useValue: billingServiceMock },
      ],
    })
      .overrideComponent(BillingComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackMock }] },
      })
      .compileComponents();

    fixture   = TestBed.createComponent(BillingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('form should be invalid when empty', () => {
    expect(component.invoiceForm.invalid).toBe(true);
  });

  it('should call createInvoice with correct payload', () => {
    billingServiceMock.createInvoice.mockReturnValue(of(mockInvoice));
    component.invoiceForm.setValue({ contractId: 'contract-1', amount: 500, currency: 'usd' });
    component.createInvoice();
    expect(billingServiceMock.createInvoice).toHaveBeenCalledWith({
      contractId: 'contract-1', amountCents: 50000, currency: 'usd',
    });
    expect(component.invoiceResult()).toEqual(mockInvoice);
  });

  it('should show error on failure', () => {
    billingServiceMock.createInvoice.mockReturnValue(throwError(() => ({ error: { message: 'Stripe error' } })));
    component.invoiceForm.setValue({ contractId: 'c-1', amount: 100, currency: 'usd' });
    component.createInvoice();
    expect(snackMock.open).toHaveBeenCalledWith('Stripe error', 'Dismiss', expect.any(Object));
    expect(component.submitting()).toBe(false);
  });

  it('should use fallback message when error has no message', () => {
    billingServiceMock.createInvoice.mockReturnValue(throwError(() => ({})));
    component.invoiceForm.setValue({ contractId: 'c-1', amount: 100, currency: 'usd' });
    component.createInvoice();
    expect(snackMock.open).toHaveBeenCalledWith('Failed to create invoice.', 'Dismiss', expect.any(Object));
  });

  it('createInvoice returns early when form is invalid', () => {
    component.createInvoice(); // form is empty/invalid
    expect(billingServiceMock.createInvoice).not.toHaveBeenCalled();
  });

  it('copySecret does nothing when invoiceResult is null', () => {
    component.invoiceResult.set(null);
    component.copySecret();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copySecret writes clientSecret to clipboard and shows snackbar', () => {
    component.invoiceResult.set(mockInvoice);
    component.copySecret();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('pi_test_secret');
    expect(snackMock.open).toHaveBeenCalledWith('Copied to clipboard.', 'OK', expect.any(Object));
  });

  it('openPortal posts to portal-session and sets openingPortal signal', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const locationSpy = jest.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, href: '' } as any);
    component.openPortal();
    expect(component.openingPortal()).toBe(true);
    const req = httpMock.expectOne('/api/billing/portal-session');
    expect(req.request.method).toBe('POST');
    req.flush({ url: 'https://billing.stripe.com/session/123' });
    expect(component.openingPortal()).toBe(false);
    locationSpy.mockRestore();
    httpMock.verify();
  });

  it('openPortal shows error on failure', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    component.openPortal();
    httpMock.expectOne('/api/billing/portal-session').flush({ message: 'No customer' }, { status: 400, statusText: 'Bad' });
    expect(component.openingPortal()).toBe(false);
    expect(snackMock.open).toHaveBeenCalled();
    httpMock.verify();
  });
});
