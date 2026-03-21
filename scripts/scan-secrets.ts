#!/usr/bin/env npx tsx
import { execSync } from 'node:child_process';

const PATTERNS = [
  { name: 'AWS Access Key',       re: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Key',       re: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/ },
  { name: 'Stripe Secret Key',    re: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'Stripe Webhook Secret', re: /whsec_[0-9a-zA-Z]{24,}/ },
  { name: 'Postmark API Token',   re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ },
  { name: 'Private Key Header',   re: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic High Entropy', re: /(?:password|secret|token|api_key|apikey|private_key)\s*[:=]\s*['"][^'"]{16,}['"]/i },
  { name: 'DocuSign Token',       re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { name: 'Sentry DSN',           re: /https:\/\/[a-f0-9]{32}@[a-z0-9.]+\.ingest\.sentry\.io/ },
];

const IGNORE_PATHS = [
  'node_modules', '.git', 'dist', 'coverage', 'package-lock.json', 'pnpm-lock.yaml',
  '*.test.ts', '*.spec.ts', 'scan-secrets.ts',
];

function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getStagedContent(file: string): string {
  try {
    return execSync(`git show ":${file}"`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATHS.some(p => {
    if (p.startsWith('*')) return filePath.endsWith(p.slice(1));
    return filePath.includes(p);
  });
}

const files = getStagedFiles();
const violations: Array<{ file: string; line: number; pattern: string; snippet: string }> = [];

for (const file of files) {
  if (shouldIgnore(file)) continue;

  const content = getStagedContent(file);
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of PATTERNS) {
      const match = re.exec(line);
      if (match) {
        const start = Math.max(0, match.index - 10);
        const end = Math.min(line.length, match.index + match[0].length + 10);
        const snippet = line.slice(start, end);
        violations.push({ file, line: i + 1, pattern: name, snippet: `...${snippet}...` });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n  SECRET SCAN FAILED — potential secrets detected in staged files:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]`);
    console.error(`    ${v.snippet}\n`);
  }
  console.error('  Remove secrets before committing. Use environment variables instead.');
  console.error('  If this is a false positive, add the path to IGNORE_PATHS in scripts/scan-secrets.ts\n');
  process.exit(1);
}

console.log('  Secret scan passed — no secrets detected in staged files.');
process.exit(0);
