import 'zone.js/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { DocumentService, Document } from './document.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('DocumentService', () => {
  let service: DocumentService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api/documents';

  const mockDoc: Document = {
    id: 'd1', filename: 'contract.pdf', mimeType: 'application/pdf',
    sizeBytes: 2048, kind: 'UPLOADED', status: 'ACTIVE',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        DocumentService,
      ],
    });
    service = TestBed.inject(DocumentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getDocuments()', () => {
    it('passes matterId as query param', () => {
      service.getDocuments('m1').subscribe(docs => expect(docs).toEqual([mockDoc]));
      const req = httpMock.expectOne(r => r.url === apiUrl && r.params.get('matterId') === 'm1');
      expect(req.request.method).toBe('GET');
      req.flush([mockDoc]);
    });

    it('propagates HTTP errors', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getDocuments('m1').subscribe({ error: e => (error = e) });
      httpMock.expectOne(r => r.url === apiUrl).flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      tick();
      expect(error!.status).toBe(403);
    }));
  });

  describe('getDocument()', () => {
    it('fetches a single document', () => {
      service.getDocument('d1').subscribe(doc => expect(doc).toEqual(mockDoc));
      const req = httpMock.expectOne(`${apiUrl}/d1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockDoc);
    });

    it('propagates 404', fakeAsync(() => {
      let error: HttpErrorResponse | undefined;
      service.getDocument('missing').subscribe({ error: e => (error = e) });
      httpMock.expectOne(`${apiUrl}/missing`).flush('Not Found', { status: 404, statusText: 'Not Found' });
      tick();
      expect(error!.status).toBe(404);
    }));
  });

  describe('uploadDocument()', () => {
    it('POSTs FormData to /upload and returns document', () => {
      const formData = new FormData();
      formData.append('matterId', 'm1');
      service.uploadDocument(formData).subscribe(doc => expect(doc).toEqual(mockDoc));
      const req = httpMock.expectOne(`${apiUrl}/upload`);
      expect(req.request.method).toBe('POST');
      req.flush(mockDoc);
    });
  });

  describe('getDownloadUrl()', () => {
    it('returns presigned download URL', () => {
      const url = 'https://s3.example.com/presigned';
      service.getDownloadUrl('d1').subscribe(res => expect(res.url).toBe(url));
      const req = httpMock.expectOne(`${apiUrl}/d1/download`);
      expect(req.request.method).toBe('GET');
      req.flush({ url });
    });
  });

  describe('deleteDocument()', () => {
    it('sends DELETE request', () => {
      let called = false;
      service.deleteDocument('d1').subscribe(() => (called = true));
      const req = httpMock.expectOne(`${apiUrl}/d1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      expect(called).toBe(true);
    });
  });
});
