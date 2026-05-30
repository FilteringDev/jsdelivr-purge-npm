import tseslint from 'typescript-eslint'

const config = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'semi': ['error', 'never'],
      'quotes': ['error', 'single'],
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/naming-convention': ['error', {
        selector: ['variableLike', 'parameterProperty', 'classProperty', 'typeProperty'],
        format: ['PascalCase']
      }]
    }
  }
]

export default config
