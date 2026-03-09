import { fixupPluginRules } from '@eslint/compat';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';
import sonarjsPlugin from 'eslint-plugin-sonarjs';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';

/**
 * eslint-plugin-import relies on removed ESLint 10 SourceCode methods.
 * @see https://github.com/import-js/eslint-plugin-import/issues/3227
 */
const patchImportPlugin = (configs) =>
  configs.map((config) => {
    if (config.plugins?.import) {
      return {
        ...config,
        plugins: { ...config.plugins, import: fixupPluginRules(config.plugins.import) },
      };
    }
    return config;
  });

const ALLOWED_MAGIC_NUMBERS = [
  -1, 0, 1, 2, 3, 10, 12, 24, 30, 60, 100, 1000, 1024,
  200, 201, 204, 301, 302, 400, 401, 403, 404, 409, 429, 500, 502, 503,
];

const eslintConfig = defineConfig([
  ...patchImportPlugin(nextVitals),
  ...patchImportPlugin(nextTs),

  // Global ignores
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/out/**',
    '**/coverage/**',
    '**/build/**',
    '**/*.config.*',
    '.claude/**',
    '.worktrees/**',
    '**/scripts/**',
    '**/database.types.ts',
    '**/types/*.types.ts',
    'supabase/next/next-env.d.ts',
    'supabase/next/css.d.ts',
    'supabase/next/scss.d.ts',
    'supabase/next/public/sw.js',
    'supabase/functions/**',
  ]),

  // Next.js settings
  {
    settings: {
      next: { rootDir: 'supabase/next' },
      react: { version: '19' },
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // Main rules
  {
    plugins: {
      sonarjs: sonarjsPlugin,
      'unused-imports': unusedImportsPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false },
      ],
      // Delegated to unused-imports/no-unused-vars to avoid duplicate reports
      '@typescript-eslint/no-unused-vars': 'off',

      // Type consistency
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',

      // Strict type checking
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: true,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: false,
          allowNullableString: true,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',

      // Async/promise safety
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: true, arguments: true, properties: true, returns: true, variables: true } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/promise-function-async': 'error',

      // Magic numbers
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: ALLOWED_MAGIC_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
        },
      ],

      // Restricted syntax
      'no-restricted-syntax': [
        'error',
        { selector: 'ForInStatement', message: 'Use for...of or Object.keys/values/entries instead' },
        { selector: 'LabeledStatement', message: 'Labels are confusing, refactor instead' },
        { selector: 'WithStatement', message: 'with is deprecated' },
        {
          selector: 'Literal[value=/^(sk-|pk-|api_|token_|secret_|key_|gh_|ghp_|gho_)[a-zA-Z0-9_-]{10,}/]',
          message: 'API keys/tokens must come from environment variables',
        },
      ],

      // Duplication detection (SonarJS)
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/no-collection-size-mischeck': 'error',
      'sonarjs/no-gratuitous-expressions': 'error',
      'sonarjs/no-nested-switch': 'error',
      'sonarjs/no-nested-template-literals': 'error',
      'sonarjs/no-inverted-boolean-check': 'error',
      'sonarjs/prefer-immediate-return': 'error',
      'sonarjs/prefer-object-literal': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',

      // Unused imports
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',

      // Error handling
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',

      // React
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react/jsx-no-leaked-render': ['error', { validStrategies: ['ternary', 'coerce'] }],
      'react/no-array-index-key': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/jsx-no-constructed-context-values': 'error',
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      'react/jsx-fragments': ['error', 'syntax'],
      'react/no-danger': 'error',

      // Code quality
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'no-lonely-if': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-useless-return': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],
      'no-multi-assign': 'error',
      'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],

      // Complexity limits
      'max-depth': ['error', 4],
      'complexity': ['error', 20],
      'max-lines-per-function': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'max-nested-callbacks': ['error', 3],

      // Import hygiene
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-mutable-exports': 'error',

      // Naming conventions
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        {
          selector: 'property',
          format: ['camelCase', 'snake_case', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
          filter: { regex: '^(Content-|Cache-|X-|Accept|Authorization|ID|URL|HTTP|API|JSON|XML|HTML|CSS|DOM|URI)', match: false },
        },
        { selector: 'objectLiteralProperty', format: null, filter: { regex: '-', match: true } },
        { selector: 'objectLiteralProperty', format: null, filter: { regex: '[a-zA-Z]+_[a-zA-Z]+', match: true } },
        { selector: 'objectLiteralProperty', format: null, filter: { regex: ':', match: true } },
        { selector: 'objectLiteralProperty', format: null, filter: { regex: '^(Authorization|Accept|Connection|Host|Origin|Referer)$', match: true } },
        { selector: 'import', modifiers: ['namespace'], format: null },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', types: ['boolean'], format: ['PascalCase', 'camelCase'], prefix: ['is', 'has', 'should', 'can', 'did', 'will', 'does', 'was'] },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],

      // Accessibility
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/html-has-lang': 'error',
      'jsx-a11y/img-redundant-alt': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/tabindex-no-positive': 'error',
    },
  },

  // Design token enforcement — UI components only
  {
    files: [
      'supabase/next/app/**/*.tsx',
      'supabase/next/app/**/*.jsx',
      'supabase/next/components/**/*.tsx',
      'supabase/next/components/**/*.jsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ForInStatement', message: 'Use for...of or Object.keys/values/entries' },
        { selector: 'LabeledStatement', message: 'Labels are confusing, refactor instead' },
        { selector: 'WithStatement', message: 'with is deprecated' },
        { selector: 'JSXExpressionContainer > Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: 'Use design tokens instead of hex colors' },
        { selector: 'JSXAttribute > Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: 'Use design tokens instead of hex colors' },
        { selector: 'JSXAttribute > Literal[value=/^rgba?\\s*\\(/i]', message: 'Use design tokens instead of rgb()' },
        { selector: 'JSXAttribute > Literal[value=/^hsla?\\s*\\(/i]', message: 'Use design tokens instead of hsl()' },
        { selector: 'JSXAttribute[name.name="className"] Literal[value=/\\w+-\\[[^\\]]+\\](?!:)/]', message: 'Use Tailwind utilities instead of arbitrary values' },
        { selector: 'JSXAttribute[name.name="className"] Literal[value=/\\b(bg|text|ring|fill|stroke)-(red|blue|green|yellow|orange|purple|pink|indigo|cyan|emerald|amber|rose|violet|fuchsia|lime|teal|sky|slate|gray|zinc|neutral|stone)-\\d+\\b/]', message: 'Use semantic Tailwind classes (bg-destructive, text-primary, etc.)' },
        { selector: 'VariableDeclarator[id.name=/^(sample|dummy|mock|fake|placeholder|hardcoded|initial)[A-Z]/] > ArrayExpression[elements.length>2]', message: 'Remove hardcoded sample data — use real data sources' },
        { selector: 'JSXAttribute[name.name="className"] Literal[value=/\\bbg-white\\b/]', message: 'Use bg-background, bg-card, or bg-popover' },
        { selector: 'JSXAttribute[name.name="className"] Literal[value=/\\btext-black\\b/]', message: 'Use text-foreground or text-muted-foreground' },
        { selector: 'JSXAttribute[name.name="className"] Literal[value=/\\btext-white\\b/]', message: 'Use text-primary-foreground or text-secondary-foreground' },
        { selector: 'JSXAttribute[name.name="className"] Literal[value=/\\bborder-(red|blue|green|yellow|orange|purple|pink|indigo|cyan|emerald|amber|rose|violet|fuchsia|lime|teal|sky|slate|gray|zinc|neutral|stone)-\\d+\\b/]', message: 'Use semantic border tokens (border-border, border-input, etc.)' },
      ],
    },
  },

  // API routes — defensive checks are legitimate
  {
    files: ['supabase/next/app/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      'max-lines-per-function': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },

  // Config/env files — magic numbers and fallback operators expected
  {
    files: [
      '**/config.ts',
      '**/constants.ts',
      '**/env.ts',
      '**/environment.ts',
      'supabase/next/lib/models.ts',
      'supabase/next/lib/agent/prompt.ts',
    ],
    rules: {
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },

  // Core logic — stricter complexity
  {
    files: ['supabase/next/lib/**/*.ts', 'supabase/next/lib/**/*.tsx'],
    ignores: ['supabase/next/lib/agent/tools.ts'],
    rules: {
      'complexity': ['error', 18],
    },
  },

  // Vendor components (shadcn, ai-elements, blocks)
  {
    files: [
      'supabase/next/components/ai-elements/**/*.{ts,tsx}',
      'supabase/next/components/ui/**/*.{ts,tsx}',
      'supabase/next/components/blocks/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-shadow': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/return-await': 'off',
      // Relaxed promise rules — async event handlers are common in UI components
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, variables: false } }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-syntax': 'off',
      'no-param-reassign': 'off',
      'no-nested-ternary': 'off',
      'max-lines-per-function': 'off',
      'max-nested-callbacks': 'off',
      'max-params': 'off',
      'complexity': 'off',
      'import/order': 'off',
      'react/jsx-no-leaked-render': 'off',
      'react/no-array-index-key': 'off',
      'react/jsx-no-constructed-context-values': 'off',
      'react/no-unescaped-entities': 'off',
      'react/no-danger': 'error',
      'react-hooks/static-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'sonarjs/no-identical-functions': 'off',
      'jsx-a11y/heading-has-content': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },

  // Hooks — relaxed patterns
  {
    files: ['supabase/next/hooks/**/*.ts', 'supabase/next/hooks/**/*.tsx'],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/naming-convention': 'off',
    },
  },

  // Type definition files
  { files: ['supabase/next/types/**/*.ts'], rules: { '@typescript-eslint/no-magic-numbers': 'off' } },

  // SchemaDisplay uses dangerouslySetInnerHTML for parameter path highlighting
  {
    files: ['supabase/next/components/ai-elements/schema-display.tsx'],
    rules: { 'react/no-danger': 'off' },
  },

  // Prettier must be last to disable conflicting formatting rules
  prettierConfig,
]);

export default eslintConfig;
