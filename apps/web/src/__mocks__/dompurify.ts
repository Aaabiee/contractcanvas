const DOMPurify = {
  sanitize: jest.fn((dirty: string) => dirty),
};
export default DOMPurify;
