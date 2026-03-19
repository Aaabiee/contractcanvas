import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BillingComponent } from './billing.component';
import { BillingService } from '../../services/billing.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

const mockInvoice = { clientSecret: 'pi_test_secret', invoiceId: 'inv-1', amountCents: 50000, currency: 'usd' };

describe('BillingComponent', () => {
  let fixture: ComponentFixture<BillingComponent>;
  let component: BillingComponent;
  let billingService: jest.Mocked<BillingService>;
  let snack: jest.Mocked<MatSnackBar>;

  beforeEach(async () => {
    const billingMock = { createInvoice: jest.fn() };
    const snackMock   = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [BillingComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimations(),
        { provide: BillingService, useValue: billingMock },
        { provide: MatSnackBar,    useValue: snackMock },
      ],
    }).compileComponents();

    billingService = TestBed.inject(BillingService) as jest.Mocked<BillingService>;
    snack          = TestBed.inject(MatSnackBar) as jest.Mocked<MatSnackBar>;
    fixture        = TestBed.createComponent(BillingComponent);
    component      = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('form should be invalid when empty', () => {
    expect(component.invoiceForm.invalid).toBe(true);
  });

  it('should call createInvoice with correct payload', () => {
    billingService.createInvoice.mockReturnValue(of(mockInvoice));
    component.invoiceForm.setValue({ contractId: 'contract-1', amount: 500, currency: 'usd' });
    component.createInvoice();
    expect(billingService.createInvoice).toHaveBeenCalledWith({
      contractId: 'contract-1', amountCents: 50000, currency: 'usd',
    });
    expect(component.invoiceResult()).toEqual(mockInvoice);
  });

  it('should show error on failure', () => {
    billingService.createInvoice.mockReturnValue(throwError(() => ({ error: { message: 'Stripe error' } })));
    component.invoiceForm.setValue({ contractId: 'c-1', amount: 100, currency: 'usd' });
    component.createInvoice();
    expect(snack.open).toHaveBeenCalledWith('Stripe error', 'Dismiss', expect.any(Object));
    expect(component.submitting()).toBe(false);
  });
});
