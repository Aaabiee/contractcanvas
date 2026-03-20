import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { DocumentsComponent } from './documents.component';
import { DocumentService, Document } from '../../services/document.service';
import { MatterService, Matter } from '../../services/matter.service';

const mockMatters: Matter[] = [
  { id: 'm1', title: 'Smith v. Acme', status: 'OPEN' },
  { id: 'm2', title: 'NDA Dispute',   status: 'OPEN' },
];

const mockDocs: Document[] = [
  { id: 'd1', filename: 'contract.pdf', mimeType: 'application/pdf', sizeBytes: 102400,
    kind: 'CONTRACT', status: 'ACTIVE', matterId: 'm1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'd2', filename: 'image.png',    mimeType: 'image/png',        sizeBytes: 51200,
    kind: 'EXHIBIT',  status: 'ACTIVE', matterId: 'm1', createdAt: '2024-01-02T00:00:00Z' },
];

class MockDocumentService {
  getDocuments   = jest.fn(() => of(mockDocs));
  uploadDocument = jest.fn(() => of(mockDocs[0]));
  getDownloadUrl = jest.fn(() => of({ url: 'https://example.com/download/d1' }));
  deleteDocument = jest.fn(() => of(undefined));
}

class MockMatterService {
  getMatters = jest.fn(() => of({ data: mockMatters, total: 2, limit: 200, offset: 0 }));
}

describe('DocumentsComponent', () => {
  let component: DocumentsComponent;
  let fixture: ComponentFixture<DocumentsComponent>;
  let docService: MockDocumentService;
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    snackBar = { open: jest.fn(() => ({ onAction: () => of(void 0) })) };

    await TestBed.configureTestingModule({
      imports: [DocumentsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: DocumentService, useClass: MockDocumentService },
        { provide: MatterService,   useClass: MockMatterService   },
      ],
    })
      .overrideComponent(DocumentsComponent, {
        add: { providers: [{ provide: MatSnackBar, useValue: snackBar }] },
      })
      .compileComponents();

    fixture   = TestBed.createComponent(DocumentsComponent);
    component = fixture.componentInstance;
    docService = TestBed.inject(DocumentService) as unknown as MockDocumentService;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads matters on init', () => {
    const ms = TestBed.inject(MatterService) as unknown as MockMatterService;
    expect(ms.getMatters).toHaveBeenCalled();
    expect(component.matters()).toHaveLength(2);
    expect(component.loadingMatters()).toBe(false);
  });

  it('loads documents when a matter is selected', fakeAsync(() => {
    component.matterCtrl.setValue('m1');
    tick(50);
    fixture.detectChanges();
    expect(docService.getDocuments).toHaveBeenCalledWith('m1');
    expect(component.documents()).toHaveLength(2);
    expect(component.loading()).toBe(false);
  }));

  it('shows empty-prompt until a matter is selected', () => {
    const prompt = fixture.nativeElement.querySelector('.empty-prompt');
    expect(prompt).toBeTruthy();
  });

  it('formatBytes formats sizes correctly', () => {
    expect(component.formatBytes(0)).toBe('0 B');
    expect(component.formatBytes(512)).toBe('512 B');
    expect(component.formatBytes(2048)).toBe('2.0 KB');
    expect(component.formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('fileIcon returns correct icons for mime types', () => {
    expect(component.fileIcon('application/pdf')).toBe('picture_as_pdf');
    expect(component.fileIcon('image/png')).toBe('image');
    expect(component.fileIcon('application/msword')).toBe('description');
    expect(component.fileIcon('application/vnd.ms-excel')).toBe('table_chart');
    expect(component.fileIcon('text/plain')).toBe('insert_drive_file');
    expect(component.fileIcon('')).toBe('insert_drive_file');
  });

  it('download calls getDownloadUrl and opens window', fakeAsync(() => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    component.download(mockDocs[0]);
    tick();
    expect(docService.getDownloadUrl).toHaveBeenCalledWith('d1');
    expect(openSpy).toHaveBeenCalledWith('https://example.com/download/d1', '_blank');
    openSpy.mockRestore();
  }));

  it('download shows snackbar on error', () => {
    docService.getDownloadUrl.mockReturnValue(throwError(() => new Error('fail')));
    component.download(mockDocs[0]);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Could not get download link.', 'Dismiss', expect.any(Object));
  });

  it('confirmDelete removes document after snackbar action', fakeAsync(() => {
    component.documents.set([...mockDocs]);
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });
    component.confirmDelete(mockDocs[0]);
    tick();
    expect(docService.deleteDocument).toHaveBeenCalledWith('d1');
    expect(component.documents()).toHaveLength(1);
    expect(component.documents()[0].id).toBe('d2');
    expect(snackBar.open).toHaveBeenCalledWith('Document deleted.', 'OK', expect.any(Object));
  }));

  it('confirmDelete shows error snackbar when delete fails', fakeAsync(() => {
    component.documents.set([...mockDocs]);
    docService.deleteDocument.mockReturnValue(throwError(() => new Error('fail')));
    snackBar.open.mockReturnValue({ onAction: () => of(void 0) });
    component.confirmDelete(mockDocs[0]);
    tick();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Failed to delete document.', 'Dismiss', expect.any(Object));
  }));

  it('upload button is disabled when no matter selected', () => {
    component.matterCtrl.setValue(null);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button[disabled]');
    expect(btn).toBeTruthy();
  });
});
