module.exports = {
  preset: 'jest-preset-angular',
  setupFiles: ['<rootDir>/setup-jest.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/apps/api/'],
  moduleNameMapper: { '^dompurify$': '<rootDir>/src/__mocks__/dompurify.ts' },
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
};
