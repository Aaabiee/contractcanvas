import 'zone.js/testing';
/**
 * Component integration tests for DocumentsComponent.
 *
 * Uses REAL DocumentService + MatterService with HttpTestingController
 * to verify the full component → service → HTTP request chain.
 */

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { DocumentsComponent } from './documents.component';
import { DocumentService } from '../../services/document.service';
import { MatterService }   from '../../services/matter.service';

const matterPage = (data: any[]) => ({ data, total: data.length, limit: 200, offset: 0 });

const mockMatters = [
  { id: 'm1', title: 'Smith v. Acme', status: 'OPEN'  },
  { id: 'm2', title: 'NDA Dispute',   status: 'OPEN'  },
];

const mockDocs = [
  { id: 'd1', filename: 'contract.pdf', mimeType: 'application/pdf', sizeBytes: 102400,
    kind: 'CONTRACT', status: 'ACTIVE', matterId: 'm1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'd2', filename: 'image.png',    mimeType: 'image/png',        sizeBytes: 51200,
    kind: 'EXHIBIT',  status: 'ACTIVE', matterId: 'm1', createdAt: '2024-01-02T00:00:00Z' },
];

describe('DocumentsComponent (integration — real DocumentService + MatterService)', () => {
  let fixture:   ComponentFixture<DocumentsComponent>;
  let component: DocumentsComponent;
  let httpMock:  HttpTestingController;
  let snackBar:  { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [DocumentsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        DocumentService,
        MatterService,
      ],
    })
      .overrideComponent(DocumentsComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    httpMock  = TestBed.inject(HttpTestingController);
    fixture   = TestBed.createComponent(DocumentsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => httpMock.verify());

  it('sends GET /api/matters on init to load the matter selector', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === '/api/matters');
    expect(req.request.method).toBe('GET');
    req.flush(matterPage(mockMatters));
    tick();

    expect(component.matters()).toHaveLength(2);
    expect(component.loadingMatters()).toBe(false);
  }));

  it('shows .empty-prompt until a matter is selected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/matters').flush(matterPage(mockMatters));
    tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.empty-prompt')).toBeTruthy();
  }));

  it('sends GET /api/documents?matterId=m1 when a matter is selected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/matters').flush(matterPage(mockMatters));
    tick();

    component.matterCtrl.setValue('m1');
    tick(50); // debounce

    const req = httpMock.expectOne(r =>
      r.url === '/api/documents' && r.params.get('matterId') === 'm1'
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockDocs);
    tick();

    expect(component.documents()).toHaveLength(2);
    expect(component.loading()).toBe(false);
  }));

  it('sends GET /api/documents when matter selection changes', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/matters').flush(matterPage(mockMatters));
    tick();

    component.matterCtrl.setValue('m1');
    tick(50);
    httpMock.expectOne(r => r.url === '/api/documents' && r.params.get('matterId') === 'm1').flush([]);
    tick();

    component.matterCtrl.setValue('m2');
    tick(50);

    const req = httpMock.expectOne(r =>
      r.url === '/api/documents' && r.params.get('matterId') === 'm2'
    );
    req.flush([{ id: 'd3', filename: 'other.pdf', mimeType: 'application/pdf', sizeBytes: 1024,
      kind: 'UPLOADED', status: 'ACTIVE', matterId: 'm2', createdAt: '2024-01-01T00:00:00Z' }]);
    tick();

    expect(component.documents()[0].matterId).toBe('m2');
  }));

  it('download calls GET /api/documents/:id/download and opens window', fakeAsync(() => {
    component.documents.set([...mockDocs]);
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    component.download(mockDocs[0]);

    const req = httpMock.expectOne('/api/documents/d1/download');
    expect(req.request.method).toBe('GET');
    req.flush({ url: 'https://s3.example.com/contract.pdf' });
    tick();

    expect(openSpy).toHaveBeenCalledWith('https://s3.example.com/contract.pdf', '_blank');
    openSpy.mockRestore();
  }));

  it('download shows snackbar on HTTP error', fakeAsync(() => {
    component.documents.set([...mockDocs]);
    component.download(mockDocs[0]);

    httpMock
      .expectOne('/api/documents/d1/download')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    expect(snackBar.open).toHaveBeenCalledWith('Could not get download link.', 'Dismiss', expect.any(Object));
  }));

  it('confirmDelete sends DELETE /api/documents/:id and removes document from list', fakeAsync(() => {
    component.documents.set([...mockDocs]);
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });

    component.confirmDelete(mockDocs[0]);
    tick();

    const req = httpMock.expectOne('/api/documents/d1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(component.documents()).toHaveLength(1);
    expect(component.documents()[0].id).toBe('d2');
    expect(snackBar.open).toHaveBeenCalledWith('Document deleted.', 'OK', expect.any(Object));
  }));

  it('confirmDelete shows error snackbar on HTTP failure', fakeAsync(() => {
    component.documents.set([...mockDocs]);
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });

    component.confirmDelete(mockDocs[0]);
    tick();

    httpMock
      .expectOne('/api/documents/d1')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    expect(snackBar.open).toHaveBeenCalledWith('Failed to delete document.', 'Dismiss', expect.any(Object));
  }));

  it('formatBytes formats correctly', () => {
    expect(component.formatBytes(0)).toBe('0 B');
    expect(component.formatBytes(1024)).toBe('1.0 KB');
    expect(component.formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('fileIcon returns correct icon names', () => {
    expect(component.fileIcon('application/pdf')).toBe('picture_as_pdf');
    expect(component.fileIcon('image/png')).toBe('image');
    expect(component.fileIcon('application/msword')).toBe('description');
    expect(component.fileIcon('unknown/type')).toBe('insert_drive_file');
  });

  it('upload button is disabled when no matter is selected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === '/api/matters').flush(matterPage(mockMatters));
    tick();
    fixture.detectChanges();

    component.matterCtrl.setValue(null);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('button[disabled]');
    expect(btn).toBeTruthy();
  }));
});
