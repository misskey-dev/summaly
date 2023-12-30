module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		tsconfigRootDir: __dirname,
		project: ['./tsconfig.json', './test/tsconfig.json'],
	},
	ignorePatterns: ['**/.eslintrc.cjs'],
	extends: [
		'plugin:@misskey-dev/recommended',
	],
	rules: {
		'@typescript-eslint/prefer-nullish-coalescing': 'off',
		'import/no-default-export': 'off',
	},
};
