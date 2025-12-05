module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test", "<rootDir>/libs"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest"
  },
  moduleNameMapper: {
    "^@adapt/validation$": "<rootDir>/libs/validation/src/index.ts"
  }
};
