// apps/web/src/app/app.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router'; // Import the modern provider
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    // Configure the test bed for a standalone component
    await TestBed.configureTestingModule({
      imports: [
        AppComponent // Import the standalone AppComponent
      ],
      providers: [
        // Provide a mock/empty router for the <router-outlet>
        provideRouter([])
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // You can optionally add this test back if you uncomment the 'title' signal
  it(`should have the 'cc-web' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title()).toEqual('cc-web'); // Use () to read the signal's value
  });
});