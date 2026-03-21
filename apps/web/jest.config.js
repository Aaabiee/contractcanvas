module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/apps/api/'],
  moduleNameMapper: { '^dompurify$': '<rootDir>/src/__mocks__/dompurify.ts' },
};
