/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  forceExit: true,
  moduleNameMapper: {
    '^@forgeq/postgres$': '<rootDir>/packages/postgres/src',
    '^@forgeq/core$': '<rootDir>/packages/core/src',
  },
}
