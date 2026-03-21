module.exports = {
  preset: 'jest-preset-angular',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/apps/api/'],
  moduleNameMapper: { '^dompurify$': '<rootDir>/src/__mocks__/dompurify.ts' },
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
};
